import { create } from 'zustand'
import { runBackup, type BackupReport } from '../core/backup/engine'
import type { Progress } from '../core/backup/progress'
import { mergeForced } from '../core/backup/report'
import { Controller } from '../core/control'
import { ensureDiskId, renameDisk } from '../core/disk'
import { ManifestStore } from '../core/manifest/store'
import { DEFAULT_SETTINGS, type Device, type Settings } from '../core/settings'
import { CancelledError, type SourceFile } from '../core/types'
import { db, type DiskRecord, type HistoryRecord, type SourceRecord } from '../db'
import { createAnalyzer } from '../platform/analyzer'
import { capabilities, ensurePermission } from '../platform/capabilities'
import { checkDisk, DISK_POLL_MS, type DiskStatus } from '../platform/disk-monitor'
import { io, workerExif, workerHasher } from '../platform/io'
import { BATTERY_PAUSE, BATTERY_WARN, keepScreenOn, readBattery, watchBattery, type BatteryInfo, type WakeState } from '../platform/power'
import { isInside, walkSource } from '../platform/walk'
import { diskTarget, isLocked } from './keys'

/** Por qué está esperando un backup interrumpido por el disco. */
export type WaitReason = 'disconnected' | 'needs-permission' | 'other-disk'

export type Screen = 'home' | 'progress' | 'report' | 'explore' | 'tools' | 'history' | 'settings' | 'help'

export interface SourceView extends SourceRecord {
  perm: PermissionState
}

interface AppState {
  ready: boolean
  screen: Screen
  sources: SourceView[]
  disks: DiskRecord[]
  /** Estado de cada disco (por `key`), comprobado cada 3 s. */
  diskStates: Record<string, DiskStatus>
  /** Disco elegido como destino (si hay varios conectados). */
  activeDiskKey: string | null
  settings: Settings
  device: Device
  history: HistoryRecord[]
  running: boolean
  paused: boolean
  progress: Progress | null
  report: BackupReport | null
  notice: string | null
  waitReason: WaitReason | null
  wake: WakeState
  battery: BatteryInfo | null
  /** Pausado automáticamente por batería baja. */
  batteryPaused: boolean

  init(): Promise<void>
  go(screen: Screen): void
  dismissNotice(): void
  setNotice(text: string): void
  addSource(): Promise<void>
  removeSource(key: string): Promise<void>
  grantSource(key: string): Promise<void>
  addDisk(): Promise<void>
  removeDisk(key: string): Promise<void>
  renameDisk(key: string, name: string): Promise<void>
  setActiveDisk(key: string): void
  grantDisk(key: string): Promise<void>
  /** Hace el backup; con `forcePaths`, copia solo esos descartados ("Copiar igualmente"). */
  start(forcePaths?: string[]): Promise<void>
  pause(): void
  resume(): void
  cancel(): void
  saveSettings(s: Settings): Promise<void>
  saveDevice(d: Device): Promise<void>
  /** Actualiza un disco guardado (fechas de backup/comprobación, cifrado…). */
  updateDisk(key: string, patch: Partial<DiskRecord>): Promise<void>
}

let controller: Controller | null = null
const BASE_TITLE = 'Backup de fotos'

function isAbort(err: unknown) {
  return (err as Error)?.name === 'AbortError'
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault()
}

/** Nombre único para un origen nuevo (se usa como primer tramo de la ruta en el informe y el manifest). */
function uniqueName(name: string, taken: string[]) {
  let n = name
  for (let i = 2; taken.includes(n); i++) n = `${name} (${i})`
  return n
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  screen: 'home',
  sources: [],
  disks: [],
  diskStates: {},
  activeDiskKey: null,
  settings: DEFAULT_SETTINGS,
  device: { id: '', name: '' },
  history: [],
  running: false,
  paused: false,
  progress: null,
  report: null,
  notice: null,
  waitReason: null,
  wake: 'off',
  battery: null,
  batteryPaused: false,

  async init() {
    const [sources, disks, settings, device, history, activeDiskKey] = await Promise.all([
      db.listSources(),
      db.listDisks(),
      db.getSettings(),
      db.getDevice(),
      db.listHistory(),
      db.getActiveDisk(),
    ])
    const views = await Promise.all(sources.map(async (s) => ({ ...s, perm: await s.handle.queryPermission({ mode: 'read' }) })))
    set({ ready: true, sources: views, disks, settings, device, history, activeDiskKey: activeDiskKey ?? null })
    startDiskPolling()
    void readBattery().then((battery) => set({ battery }))
  },

  go: (screen) => set({ screen }),
  dismissNotice: () => set({ notice: null }),
  setNotice: (text) => set({ notice: text }),

  async addSource() {
    try {
      const h = await window.showDirectoryPicker({ id: 'backup-origen', mode: 'read', startIn: 'pictures' })
      const { sources } = get()
      for (const s of sources) {
        if (await s.handle.isSameEntry(h)) return set({ notice: `Esa carpeta ya está añadida como "${s.name}".` })
      }
      const rec: SourceRecord = { key: crypto.randomUUID(), name: uniqueName(h.name, sources.map((s) => s.name)), handle: h, addedAt: new Date().toISOString() }
      await db.putSource(rec)
      set({ sources: [...sources, { ...rec, perm: 'granted' }] })
    } catch (err) {
      if (!isAbort(err)) set({ notice: `No se pudo elegir la carpeta: ${(err as Error).message}` })
    }
  },

  async removeSource(key) {
    await db.deleteSource(key)
    set({ sources: get().sources.filter((s) => s.key !== key) })
  },

  async grantSource(key) {
    const s = get().sources.find((x) => x.key === key)
    if (!s) return
    const perm = await ensurePermission(s.handle, 'read', true)
    set({ sources: get().sources.map((x) => (x.key === key ? { ...x, perm } : x)) })
  },

  async addDisk() {
    try {
      const h = await window.showDirectoryPicker({ id: 'backup-destino', mode: 'readwrite' })
      const { disks } = get()
      // Cada disco tiene un identificador en .backup-disk-id; se crea la primera vez.
      const info = await ensureDiskId(diskTarget({ handle: h, diskId: null }), h.name)
      const existing = disks.find((d) => d.diskId === info.id)
      let rec: DiskRecord
      if (existing) {
        // El mismo disco elegido otra vez (p. ej. con otra letra en Windows): se actualiza su carpeta.
        rec = { ...existing, handle: h, name: info.name }
      } else {
        rec = { key: crypto.randomUUID(), diskId: info.id, name: info.name, handle: h, addedAt: new Date().toISOString(), encrypted: !!info.encryption }
      }
      await db.putDisk(rec)
      await db.setActiveDisk(rec.key)
      set({ disks: existing ? disks.map((d) => (d.key === rec.key ? rec : d)) : [...disks, rec], activeDiskKey: rec.key })
      void refreshDisks()
    } catch (err) {
      if (!isAbort(err)) set({ notice: `No se pudo usar esa carpeta: ${(err as Error).message}` })
    }
  },

  async removeDisk(key) {
    // "Olvidar" solo lo quita de la app: no toca nada en el disco.
    await db.deleteDisk(key)
    set({ disks: get().disks.filter((d) => d.key !== key) })
  },

  async renameDisk(key, name) {
    const d = get().disks.find((x) => x.key === key)
    if (!d || !name.trim()) return
    const status = get().diskStates[key]
    if (status?.state === 'connected') await renameDisk(diskTarget(d), name.trim())
    await get().updateDisk(key, { name: name.trim() })
  },

  setActiveDisk(key) {
    void db.setActiveDisk(key)
    set({ activeDiskKey: key })
  },

  async grantDisk(key) {
    const d = get().disks.find((x) => x.key === key)
    if (!d) return
    await ensurePermission(d.handle, 'readwrite', true)
    await refreshDisks()
  },

  async updateDisk(key, patch) {
    const d = get().disks.find((x) => x.key === key)
    if (!d) return
    const rec = { ...d, ...patch }
    await db.putDisk(rec)
    set({ disks: get().disks.map((x) => (x.key === key ? rec : x)) })
  },

  async start(forcePaths) {
    const { running } = get()
    if (running || !capabilities.fsAccess) return
    const disk = activeDisk()
    if (!disk) {
      set({ notice: 'No hay ningún disco de backup conectado. Conéctalo (o añade uno) y vuelve a intentarlo.' })
      return
    }
    const force = forcePaths?.map((p) => lastScan.get(p)).filter((f): f is SourceFile => !!f)
    if (forcePaths && !force?.length) {
      set({ notice: 'Esos archivos ya no están disponibles en esta sesión. Vuelve a hacer el backup y cópialos desde el nuevo informe.' })
      return
    }

    // Primero los permisos: requestPermission necesita el clic del usuario.
    const dp = await ensurePermission(disk.handle, 'readwrite', true)
    if (dp !== 'granted') {
      set({ notice: 'Sin permiso de acceso al disco no se puede hacer el backup.' })
      return
    }
    const sources: SourceView[] = []
    const skipped: string[] = []
    for (const s of get().sources) {
      const perm = await ensurePermission(s.handle, 'read', true)
      if (perm !== 'granted') skipped.push(s.name)
      else if (await isInside(disk.handle, s.handle)) skipped.push(`${s.name} (está dentro de la carpeta de backup)`)
      else sources.push({ ...s, perm })
    }
    set({ sources: get().sources.map((s) => sources.find((x) => x.key === s.key) ?? s) })
    if (!force && sources.length === 0) {
      set({ notice: get().sources.length ? `No se puede leer ninguna carpeta de fotos: ${skipped.join(', ')}.` : 'Añade al menos una carpeta de fotos.' })
      return
    }
    if (disk.encrypted && isLocked(disk)) {
      set({ notice: 'Este disco está cifrado: desbloquéalo con su contraseña (en Inicio) antes de hacer el backup.' })
      return
    }
    // Batería: con el disco conectado por OTG el móvil normalmente no se carga.
    const battery = await readBattery()
    if (!force && battery && !battery.charging && battery.level < BATTERY_WARN) {
      const ok = confirm(
        `La batería está al ${Math.round(battery.level * 100)} %. El backup puede tardar y se pausará solo si baja del ${BATTERY_PAUSE * 100} %.\n\n` +
          'Si el disco está conectado al móvil por USB (OTG), el móvil normalmente no se carga a la vez, salvo con un hub USB con alimentación.\n\n¿Empezar igualmente?',
      )
      if (!ok) return
    }
    if (skipped.length) set({ notice: `Se omiten estas carpetas (sin permiso o no válidas): ${skipped.join(', ')}.` })

    await withBackupLock(() => runJob(disk, sources, force))
  },

  pause() {
    controller?.pause()
    void io.setPaused(true)
    set({ paused: true })
  },

  resume() {
    controller?.resume()
    void io.setPaused(false)
    set({ paused: false, batteryPaused: false })
  },

  cancel() {
    controller?.cancel()
    void io.cancel()
    set({ paused: false })
  },

  async saveSettings(s) {
    await db.setSettings(s)
    set({ settings: s })
  },

  async saveDevice(d) {
    await db.setDevice(d)
    set({ device: d })
  },
}))

/** Web Locks: un solo backup (o herramienta que escriba en el disco) a la vez entre pestañas y ventanas. */
export async function withBackupLock(job: () => Promise<void>) {
  if (!capabilities.webLocks) return job()
  await navigator.locks.request('backup-fotos', { ifAvailable: true }, async (lock) => {
    if (!lock) {
      useApp.setState({ notice: 'Ya hay un backup u otra operación en curso en otra pestaña o ventana. Espera a que termine.' })
      return
    }
    await job()
  })
}

/** Disco de destino: el elegido si está conectado; si no, el primero conectado. */
export function activeDisk(): DiskRecord | null {
  const { disks, diskStates, activeDiskKey } = useApp.getState()
  const usable = (d: DiskRecord) => ['connected', 'needs-permission'].includes(diskStates[d.key]?.state ?? '')
  const chosen = disks.find((d) => d.key === activeDiskKey)
  if (chosen && usable(chosen)) return chosen
  return disks.find((d) => diskStates[d.key]?.state === 'connected') ?? disks.find(usable) ?? null
}

let polling: ReturnType<typeof setInterval> | null = null
let checking = false

/** Comprueba ahora qué discos están accesibles. */
export async function refreshDisks() {
  const { disks } = useApp.getState()
  const entries = await Promise.all(disks.map(async (d) => [d.key, await checkDisk(d.handle)] as const))
  const diskStates = Object.fromEntries(entries)
  useApp.setState({ diskStates })
  // Si el nombre del disco ha cambiado en su .backup-disk-id (otro dispositivo), se actualiza aquí.
  for (const d of disks) {
    const s = diskStates[d.key]
    if (s?.state === 'connected' && ((s.id && s.id !== d.diskId) || s.name !== d.name) && s.id === (d.diskId ?? s.id)) {
      void useApp.getState().updateDisk(d.key, { diskId: s.id, name: s.name })
    }
  }
  return diskStates
}

/** Mientras la app está abierta, comprueba cada 3 s qué disco está conectado. */
function startDiskPolling() {
  if (polling) return
  const tick = async () => {
    if (checking) return
    checking = true
    try {
      await refreshDisks()
    } finally {
      checking = false
    }
  }
  void tick()
  polling = setInterval(tick, DISK_POLL_MS)
}

/**
 * El motor llama aquí cuando el disco desaparece a mitad del backup. Se
 * resuelve cuando vuelve a estar accesible el MISMO disco (mismo
 * .backup-disk-id). Si hace falta reconfirmar el permiso, la pantalla de
 * progreso muestra el botón (requestPermission necesita un clic).
 */
async function waitForDisk(disk: DiskRecord, diskId: string, ctl: Controller) {
  for (;;) {
    if (ctl.cancelled) throw new CancelledError()
    const s = await checkDisk(disk.handle)
    useApp.setState({ diskStates: { ...useApp.getState().diskStates, [disk.key]: s } })
    if (s.state === 'connected' && s.id === diskId) {
      useApp.setState({ waitReason: null })
      return
    }
    useApp.setState({ waitReason: s.state === 'connected' ? 'other-disk' : s.state === 'needs-permission' ? 'needs-permission' : 'disconnected' })
    await new Promise((r) => setTimeout(r, 2000))
  }
}

/** Archivos del último escaneo, para "Copiar igualmente" y las miniaturas del informe. */
let lastScan = new Map<string, SourceFile>()

export function scannedFile(relPath: string) {
  return lastScan.get(relPath)
}

/** Guarda qué contiene el disco (hashes y estado) para saber en cuántos discos está cada foto. */
export async function saveDiskIndex(disk: DiskRecord) {
  if (!disk.diskId) return
  try {
    const { store } = await ManifestStore.open(diskTarget(disk), disk.diskId)
    await db.putDiskIndex({ diskId: disk.diskId, name: disk.name, updatedAt: new Date().toISOString(), entries: store.entries().map((e) => [e.hash, e.status]) })
  } catch {
    // Si no se puede leer el manifest, se conserva el índice anterior.
  }
}

/**
 * Ejecuta un backup. Con `force`, copia solo esos archivos (descartados que
 * el usuario quiere conservar) sin pasar por los filtros, y fusiona el
 * resultado con el informe actual.
 */
async function runJob(initialDisk: DiskRecord, sources: SourceView[], force?: SourceFile[]) {
  let disk = initialDisk
  const { settings, device, report: previous } = useApp.getState()
  const ctl = new Controller()
  controller = ctl
  await io.reset()
  useApp.setState(
    force ? { running: true, paused: false, progress: null } : { running: true, paused: false, progress: null, report: null, screen: 'progress' },
  )
  window.addEventListener('beforeunload', onBeforeUnload)
  // Pantalla encendida mientras dure el backup.
  keepScreenOn(true, (wake) => useApp.setState({ wake }))
  // Pausa automática si la batería baja del 10 % sin cargar.
  const stopBattery = await watchBattery((battery) => {
    useApp.setState({ battery })
    const s = useApp.getState()
    if (!battery.charging && battery.level < BATTERY_PAUSE && s.running && !s.paused) {
      s.pause()
      useApp.setState({ batteryPaused: true })
    }
  })

  let report: BackupReport
  try {
    report = await runBackup({
      target: diskTarget(disk),
      diskName: disk.name,
      encrypted: !!disk.encrypted,
      scan: force
        ? async () => ({ files: force, ignored: [] })
        : async (onFound) => {
            const files: SourceFile[] = []
            const ignored: string[] = []
            for (const s of sources) {
              const r = await walkSource(s.handle, disk.handle, ctl, onFound, { label: s.name, cacheKeyPrefix: s.key, baseCount: files.length })
              files.push(...r.files)
              ignored.push(...r.ignored)
            }
            lastScan = new Map(files.map((f) => [f.relPath, f]))
            return { files, ignored }
          },
      hasher: workerHasher,
      readExif: workerExif,
      analyzer: createAnalyzer(settings.filters),
      hashCache: db.hashCache(),
      force: force && new Set(force.map((f) => f.relPath)),
      waitForDisk: (diskId) => waitForDisk(disk, diskId, ctl),
      device,
      settings,
      control: ctl,
      onProgress: (progress) => {
        useApp.setState({ progress })
        const pct = progress.totalBytes > 0 ? Math.floor((progress.doneBytes / progress.totalBytes) * 100) : 0
        document.title = `${pct}% · Backup`
      },
    })
  } catch (err) {
    useApp.setState({ running: false, screen: force ? 'report' : 'home', notice: `Error inesperado: ${(err as Error).message}` })
    return
  } finally {
    window.removeEventListener('beforeunload', onBeforeUnload)
    document.title = BASE_TITLE
    controller = null
    keepScreenOn(false)
    stopBattery()
    useApp.setState({ waitReason: null, batteryPaused: false })
  }

  await db.addHistory({
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    outcome: report.outcome,
    diskId: report.diskId,
    diskName: disk.name,
    deviceName: device.name,
    copied: report.copied.length + report.alreadyOnDisk.length,
    duplicates: report.duplicates.length,
    discarded: report.discarded.length,
    unverified: report.unverified.length,
    errors: report.errors.length + report.fat32.length,
    bytesCopied: report.bytesCopied,
  })
  // Un disco migrado de la versión anterior recibe aquí su identificador (lo crea el motor en el primer backup).
  if (report.diskId && disk.diskId !== report.diskId) {
    await useApp.getState().updateDisk(disk.key, { diskId: report.diskId })
    disk = { ...disk, diskId: report.diskId }
  }
  if (report.outcome === 'completed' && !force) {
    await useApp.getState().updateDisk(disk.key, { lastBackupAt: report.finishedAt, lastBackupFiles: report.copied.length + report.alreadyOnDisk.length })
  }
  await saveDiskIndex(disk)
  const shown = force && previous ? mergeForced(previous, report) : report
  useApp.setState({ running: false, paused: false, report: shown, screen: 'report', history: await db.listHistory() })
}
