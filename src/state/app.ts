import { flushSync } from 'react-dom'
import { create } from 'zustand'
import { runBackup, type BackupReport } from '../core/backup/engine'
import type { Progress } from '../core/backup/progress'
import { mergeForced } from '../core/backup/report'
import { Controller } from '../core/control'
import { friendlyError } from '../core/errors'
import { isMedia } from '../core/media'
import { ensureDiskId, readDiskId, renameDisk } from '../core/disk'
import { ManifestStore } from '../core/manifest/store'
import { DEFAULT_SETTINGS, type Device, type Settings } from '../core/settings'
import { CancelledError, type SourceFile } from '../core/types'
import { db, onDbBlocked, type DiskRecord, type HistoryRecord, type PendingRun, type SourceRecord } from '../db'
import { createAnalyzer } from '../platform/analyzer'
import { FsaTarget } from '../platform/fsa-target'
import { capabilities, ensurePermission } from '../platform/capabilities'
import { checkDisk, DISK_POLL_MS, type DiskStatus } from '../platform/disk-monitor'
import { io, POOL_SIZE, workerExif, workerHasher } from '../platform/io'
import { BATTERY_PAUSE, BATTERY_WARN, keepScreenOn, readBattery, watchBattery, type BatteryInfo, type WakeState } from '../platform/power'
import { checkReadable, isInside, walkSource } from '../platform/walk'
import { connectorInfo, scanCable, type CableDevice } from '../platform/connector'
import { knownOnDisk } from './copies'
import { diskTarget, isLocked } from './keys'

/** Por qué está esperando un backup interrumpido por el disco. */
export type WaitReason = 'disconnected' | 'needs-permission' | 'other-disk'

export type Screen = 'home' | 'progress' | 'report' | 'explore' | 'tools' | 'history' | 'settings' | 'help' | 'remote'

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
  /**
   * Fotos elegidas con el selector de archivos (p. ej. de un móvil conectado
   * por USB a Windows, que el selector de carpetas no puede recorrer). Solo
   * duran esta sesión.
   */
  pickedFiles: SourceFile[]
  addPickedFiles(list: FileList | null): void
  clearPickedFiles(): void
  /** Móviles por cable elegidos como origen (los lee BackupFotos.exe, que debe estar abierto). */
  cableDevices: CableDevice[]
  /** Móviles que ve ahora el programa; null si el programa no está abierto o no se ha comprobado. */
  connector: CableDevice[] | null
  /** Comprueba si BackupFotos.exe está abierto y qué móviles ve. */
  refreshConnector(): Promise<CableDevice[] | null>
  addCableDevice(d: CableDevice): Promise<void>
  removeCableDevice(id: string): Promise<void>

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
  /**
   * Hace el backup; con `forcePaths`, copia solo esos descartados ("Copiar igualmente");
   * con `resumeFolder`, continúa esa copia interrumpida (lo ya copiado se salta sin leerlo).
   */
  start(forcePaths?: string[], resumeFolder?: string): Promise<void>
  /** Copia que se quedó a medias en este navegador (para ofrecer continuarla). */
  pendingRun: PendingRun | null
  discardPendingRun(): Promise<void>
  pause(): void
  resume(): void
  cancel(): void
  saveSettings(s: Settings): Promise<void>
  saveDevice(d: Device): Promise<void>
  /** Actualiza un disco guardado (fechas de backup/comprobación, cifrado…). */
  updateDisk(key: string, patch: Partial<DiskRecord>): Promise<void>
}

let controller: Controller | null = null
/** Primer tramo de la ruta de las fotos elegidas con el selector de archivos. */
export const PICKED_LABEL = 'Fotos elegidas'
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
  pickedFiles: [],
  cableDevices: [],
  connector: null,
  pendingRun: null,

  async discardPendingRun() {
    set({ pendingRun: null })
    await db.setPendingRun(null)
  },

  async refreshConnector() {
    const info = await connectorInfo()
    const devices = info?.devices ?? null
    set({ connector: devices })
    // Si el programa ve el móvil con otro identificador (vuelto a conectar), se reconoce por el nombre.
    if (devices) {
      const updated = get().cableDevices.map((c) => (devices.some((d) => d.id === c.id) ? c : devices.find((d) => d.name === c.name) ?? c))
      if (updated.some((c, i) => c.id !== get().cableDevices[i].id)) {
        set({ cableDevices: updated })
        await db.setCableDevices(updated)
      }
    }
    return devices
  },

  async addCableDevice(d) {
    if (get().cableDevices.some((c) => c.id === d.id)) return
    const list = [...get().cableDevices, d]
    set({ cableDevices: list })
    await db.setCableDevices(list)
  },

  async removeCableDevice(id) {
    const list = get().cableDevices.filter((c) => c.id !== id)
    set({ cableDevices: list })
    await db.setCableDevices(list)
  },

  addPickedFiles(list) {
    if (!list) return
    const seen = new Set(get().pickedFiles.map((f) => `${f.relPath}|${f.size}`))
    const added: SourceFile[] = []
    for (const file of Array.from(list)) {
      if (!isMedia(file.name)) continue
      const rel = `${PICKED_LABEL}/${(file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name}`
      if (seen.has(`${rel}|${file.size}`)) continue
      seen.add(`${rel}|${file.size}`)
      added.push({ relPath: rel, name: file.name, size: file.size, lastModified: file.lastModified, getFile: async () => file, cacheKey: `picked:${rel}` })
    }
    set({ pickedFiles: [...get().pickedFiles, ...added] })
  },

  clearPickedFiles: () => set({ pickedFiles: [] }),

  async init() {
    onDbBlocked(() =>
      set({ notice: 'Hay otra pestaña abierta con una versión anterior de la app. Ciérrala y recarga esta página para continuar.' }),
    )
    const [sources, disks, settings, device, history, activeDiskKey, cableDevices, pendingRun] = await Promise.all([
      db.listSources(),
      db.listDisks(),
      db.getSettings(),
      db.getDevice(),
      db.listHistory(),
      db.getActiveDisk(),
      db.getCableDevices(),
      db.getPendingRun(),
    ])
    const views = await Promise.all(sources.map(async (s) => ({ ...s, perm: await s.handle.queryPermission({ mode: 'read' }) })))
    set({ ready: true, sources: views, disks, settings, device, history, activeDiskKey: activeDiskKey ?? null, cableDevices, pendingRun })
    startDiskPolling()
    void readBattery().then((battery) => set({ battery }))
  },

  go: (screen) => {
    if (get().screen === screen) return
    const apply = () => {
      flushSync(() => set({ screen }))
      window.scrollTo({ top: 0 })
    }
    // Transición suave entre pantallas (View Transitions API) si el navegador la tiene y no se pide reducir el movimiento.
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if ('startViewTransition' in document && !reduced && document.visibilityState === 'visible') {
      const t = document.startViewTransition(apply)
      // Si el navegador aborta la animación (pestaña oculta, otra navegación…), la pantalla ya ha cambiado igualmente.
      const ignore = () => {}
      t.ready.catch(ignore)
      t.finished.catch(ignore)
      t.updateCallbackDone.catch(ignore)
    } else apply()
  },
  dismissNotice: () => set({ notice: null }),
  setNotice: (text) => set({ notice: text }),

  async addSource() {
    try {
      const h = await window.showDirectoryPicker({ id: 'backup-origen', mode: 'read', startIn: 'pictures' })
      const { sources } = get()
      for (const s of sources) {
        // Una carpeta guardada que ya no existe (móvil desconectado) no debe impedir añadir otra.
        if (await s.handle.isSameEntry(h).catch(() => false)) return set({ notice: `Esa carpeta ya está añadida como "${s.name}".` })
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
      // Con "una carpeta por copia" no se escribe nada en la carpeta elegida: cada copia lleva dentro
      // su propio .backup-disk-id. Si no, el destino tiene su identificador (se crea la primera vez).
      const root = diskTarget({ handle: h, diskId: null })
      const info = get().settings.runFolder ? await readDiskId(root) : await ensureDiskId(root, h.name)
      let existing = info ? disks.find((d) => d.diskId === info.id) : undefined
      for (const d of disks) if (!existing && (await d.handle.isSameEntry(h).catch(() => false))) existing = d
      let rec: DiskRecord
      if (existing) {
        // La misma carpeta elegida otra vez (p. ej. con otra letra en Windows): se actualiza.
        rec = { ...existing, handle: h, name: info?.name ?? existing.name }
      } else {
        rec = { key: crypto.randomUUID(), diskId: info?.id ?? null, name: info?.name ?? h.name, handle: h, addedAt: new Date().toISOString(), encrypted: !!info?.encryption }
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

  async start(forcePaths, resumeFolder) {
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
      let perm: PermissionState
      try {
        perm = await ensurePermission(s.handle, 'read', true)
      } catch (err) {
        skipped.push(`${s.name} (${friendlyError(err)})`)
        continue
      }
      // ¿Sigue accesible? (p. ej. un móvil desconectado o vuelto a conectar: la carpeta guardada ya no vale)
      const unreadable = perm === 'granted' ? await checkReadable(s.handle) : null
      if (perm !== 'granted') skipped.push(`${s.name} (sin permiso)`)
      else if (unreadable) skipped.push(`${s.name}: no se puede abrir. Si es un móvil, comprueba que sigue conectado y desbloqueado; si aun así falla, quita esa carpeta y vuelve a añadirla`)
      else if (await isInside(disk.handle, s.handle)) skipped.push(`${s.name} (está dentro de la carpeta de backup)`)
      else sources.push({ ...s, perm })
    }
    set({ sources: get().sources.map((s) => sources.find((x) => x.key === s.key) ?? s) })
    // Móviles por cable: el programa BackupFotos.exe tiene que estar abierto y verlos.
    let cable: CableDevice[] = []
    if (!force && get().cableDevices.length) {
      const seen = await get().refreshConnector()
      if (!seen) skipped.push('Móvil por cable: abre BackupFotos.exe (el programa que lee el móvil) y vuelve a pulsar Hacer backup')
      else {
        cable = get().cableDevices.filter((c) => seen.some((d) => d.id === c.id))
        for (const c of get().cableDevices) if (!cable.includes(c)) skipped.push(`${c.name} (no está conectado: conéctalo, desbloquéalo y elige "Transferencia de archivos")`)
      }
    }
    if (!force && sources.length === 0 && get().pickedFiles.length === 0 && cable.length === 0) {
      set({
        notice: get().sources.length
          ? `No se puede leer ninguna carpeta de fotos: ${skipped.join(', ')}.`
          : get().cableDevices.length
            ? `No se puede leer el móvil: ${skipped.join(', ')}.`
            : 'Añade al menos una carpeta de fotos, un móvil por cable o elige fotos sueltas.',
      })
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

    // Avisos del sistema al terminar (se pide permiso una vez, aprovechando el clic).
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission().catch(() => {})
    await withBackupLock(() => runJob(disk, sources, force, cable, resumeFolder))
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
    if (s?.state === 'connected' && ((s.id && s.id !== d.diskId) || s.name !== d.name || s.encrypted !== !!d.encrypted) && s.id === (d.diskId ?? s.id)) {
      void useApp.getState().updateDisk(d.key, { diskId: s.id, name: s.name, encrypted: s.encrypted })
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
async function waitForDisk(disk: DiskRecord, diskId: string, ctl: Controller, snapshot: boolean) {
  for (;;) {
    if (ctl.cancelled) throw new CancelledError()
    const s = await checkDisk(disk.handle)
    useApp.setState({ diskStates: { ...useApp.getState().diskStates, [disk.key]: s } })
    // Con una carpeta por copia, el identificador está dentro de la copia: basta con que vuelva la misma carpeta.
    if (s.state === 'connected' && (snapshot || s.id === diskId)) {
      useApp.setState({ waitReason: null })
      return
    }
    useApp.setState({ waitReason: s.state === 'connected' ? 'other-disk' : s.state === 'needs-permission' ? 'needs-permission' : 'disconnected' })
    await new Promise((r) => setTimeout(r, 2000))
  }
}

/** Badging API (número en el icono de la app instalada), si el navegador la tiene. */
function badgeApi() {
  return navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
}

/** Aviso del sistema al terminar, si la pestaña no está a la vista. */
function notifyDone(report: BackupReport, diskName: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return
  const copied = report.copied.length + report.alreadyOnDisk.length
  const body =
    report.outcome === 'completed'
      ? `${copied} fotos y vídeos copiados y verificados en ${report.folder ?? diskName}.`
      : 'El backup se ha detenido. Abre la app para ver qué ha pasado y continuar.'
  try {
    const n = new Notification(report.outcome === 'completed' ? 'Backup terminado' : 'Backup detenido', { body, icon: `${import.meta.env.BASE_URL}icon-192.png`, tag: 'backup' })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    // Algunos navegadores solo permiten avisos desde el service worker: no es imprescindible.
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
/** Fotos que llegan de un móvil por internet (ver state/remote): se copian como un origen más. */
export interface RemoteSource {
  name: string
  files: SourceFile[]
  dirs: string[]
}

/**
 * Copia en el PC de casa lo que envía un móvil por internet. No hay nadie delante del PC:
 * el disco tiene que estar conectado y con permiso (se concedió al activar "Recibir del móvil").
 * Si la última copia de ese móvil se quedó a medias, se continúa en su carpeta.
 */
export async function startRemote(remote: RemoteSource, diskKey?: string): Promise<BackupReport | null> {
  const s = useApp.getState()
  if (s.running) throw new Error('El PC está haciendo otra copia ahora mismo.')
  // El destino elegido desde el móvil (o el de siempre del PC).
  const disk = (diskKey && s.disks.find((d) => d.key === diskKey)) || activeDisk()
  if (!disk || s.diskStates[disk.key]?.state !== 'connected') throw new Error(`El destino${disk ? ` "${disk.name}"` : ''} no está conectado en el PC.`)
  if ((await disk.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('El PC ha perdido el permiso del disco: vuelve a activar "Recibir del móvil" en el PC.')
  if (disk.encrypted && isLocked(disk)) throw new Error('El disco del PC está cifrado y bloqueado.')
  const pending = s.pendingRun
  const resume = pending && pending.diskKey === disk.key && pending.folder.startsWith(`${remote.name} - `) ? pending.folder : undefined
  let result: BackupReport | null = null
  await withBackupLock(async () => {
    await runJob(disk, [], undefined, [], resume, remote)
    result = useApp.getState().report
  })
  return result
}

async function runJob(initialDisk: DiskRecord, sources: SourceView[], force?: SourceFile[], cable: CableDevice[] = [], resumeFolder?: string, remote?: RemoteSource) {
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

  const snapshot = settings.runFolder && !disk.encrypted
  /** Con un único móvil por cable como origen, la carpeta de la copia lleva su nombre (el que da Windows). */
  let cableName: string | null = null
  const onlyCable = !remote && cable.length === 1 && sources.length === 0 && useApp.getState().pickedFiles.length === 0
  const originCount = remote ? 1 : cable.length + sources.length + (useApp.getState().pickedFiles.length ? 1 : 0)
  if (remote) cableName = remote.name
  // "Solo lo nuevo": índice de lo que ya hay en las copias del disco (solo se leen sus registros, no las fotos).
  const known = snapshot && settings.onlyNew && !force ? await knownOnDisk(disk) : null
  let badge = -1
  let report: BackupReport
  try {
    report = await runBackup({
      target: diskTarget(disk),
      // Cada backup en su carpeta "Móvil - fecha hora" (creada dentro del destino; todo va dentro).
      openRunFolder: snapshot ? async (name) => new FsaTarget(await disk.handle.getDirectoryHandle(name, { create: true })) : undefined,
      runFolderName: force && previous?.folder ? previous.folder : resumeFolder,
      // Misma estructura de carpetas que en el móvil; con un solo origen, sin repetir su nombre.
      mirror: snapshot && settings.keepStructure ? { stripFirst: originCount === 1 } : undefined,
      knownElsewhere: known ? (h) => known.get(h) : undefined,
      // HEIC → JPG comprobado (en un disco cifrado no: allí se guarda todo tal cual).
      convertHeic: settings.heicToJpg && !disk.encrypted ? (b) => io.heicToJpeg(b) : undefined,
      sourceName: () => cableName,
      // Una carpeta por copia (copia completa): cada foto se lee una sola vez, directa al disco y verificada,
      // sin pasadas previas de huellas ni de análisis. Con el móvil por cable es lo que marca la diferencia.
      readOnce: snapshot,
      slowSource: cable.length > 0 || !!remote,
      diskName: disk.name,
      encrypted: !!disk.encrypted,
      scan: force
        ? async () => ({ files: force, ignored: [] })
        : remote
          ? async (onFound) => {
              // Lo que envía el móvil por internet (ya recorrido allí).
              lastScan = new Map(remote.files.map((f) => [f.relPath, f]))
              onFound(remote.files.length)
              return { files: remote.files, ignored: [], dirs: remote.dirs }
            }
          : async (onFound) => {
            const files: SourceFile[] = []
            const ignored: string[] = []
            const unreadable: Array<{ relPath: string; reason: string }> = []
            const dirs: string[] = []
            files.push(...useApp.getState().pickedFiles)
            for (const c of cable) {
              try {
                const r = await scanCable(c, uniqueName(c.name, [...sources.map((s) => s.name), PICKED_LABEL]), ctl, onFound, files.length, { skipSent: !settings.whatsappSent })
                files.push(...r.files)
                ignored.push(...r.ignored)
                unreadable.push(...(r.unreadable ?? []))
                dirs.push(...(r.dirs ?? []))
                if (onlyCable) cableName = r.name
                void db.setSentStats(c.name, { ...r.sent, measuredAt: new Date().toISOString() })
              } catch (err) {
                if ((err as Error)?.name === 'CancelledError') throw err
                unreadable.push({ relPath: c.name, reason: `${friendlyError(err)}. No se ha copiado nada de este móvil.` })
              }
            }
            for (const s of sources) {
              try {
                const r = await walkSource(s.handle, disk.handle, ctl, onFound, { label: s.name, cacheKeyPrefix: s.key, baseCount: files.length, skipSent: !settings.whatsappSent })
                files.push(...r.files)
                ignored.push(...r.ignored)
                unreadable.push(...(r.unreadable ?? []))
                dirs.push(...(r.dirs ?? []))
              } catch (err) {
                if ((err as Error)?.name === 'CancelledError') throw err
                // La carpeta entera dejó de estar accesible (móvil desconectado…): se sigue con las demás.
                unreadable.push({ relPath: s.name, reason: `${friendlyError(err)}. No se ha copiado nada de esta carpeta.` })
              }
            }
            lastScan = new Map(files.map((f) => [f.relPath, f]))
            return { files, ignored, unreadable, dirs }
          },
      hasher: workerHasher,
      readExif: workerExif,
      analyzer: createAnalyzer(settings.filters),
      hashCache: db.hashCache(),
      concurrency: POOL_SIZE,
      force: force && new Set(force.map((f) => f.relPath)),
      waitForDisk: (diskId) => waitForDisk(disk, diskId, ctl, snapshot),
      device,
      settings,
      control: ctl,
      onProgress: (progress) => {
        useApp.setState({ progress })
        // Número de archivos que faltan en el icono de la app instalada.
        const left = progress.phase === 'copy' || progress.phase === 'verify' ? progress.phaseTotal - progress.phaseDone : -1
        if (left !== badge) {
          badge = left
          if (left > 0) void badgeApi().setAppBadge?.(left).catch(() => {})
        }
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
    void badgeApi().clearAppBadge?.().catch(() => {})
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
  if (!report.folder && report.diskId && disk.diskId !== report.diskId) {
    await useApp.getState().updateDisk(disk.key, { diskId: report.diskId })
    disk = { ...disk, diskId: report.diskId }
  }
  if (report.outcome === 'completed' && !force) {
    await useApp.getState().updateDisk(disk.key, { lastBackupAt: report.finishedAt, lastBackupFiles: report.copied.length + report.alreadyOnDisk.length })
  }
  await saveDiskIndex(disk)
  // Velocidad real del último backup (para estimar cuánto tardaría añadir algo, p. ej. WhatsApp Sent).
  const secs = (new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()) / 1000
  if (report.bytesCopied > 50 * 1024 ** 2 && secs > 30) await db.setLastSpeed(report.bytesCopied / secs)
  // Copia a medias: se recuerda para ofrecer continuarla en la misma carpeta.
  if (!force && report.folder) {
    const pending = report.outcome === 'completed' ? null : { diskKey: disk.key, folder: report.folder, startedAt: report.startedAt, copied: report.copied.length + report.alreadyOnDisk.length }
    useApp.setState({ pendingRun: pending })
    await db.setPendingRun(pending)
  }
  notifyDone(report, disk.name)
  const shown = force && previous ? mergeForced(previous, report) : report
  useApp.setState({ running: false, paused: false, report: shown, screen: 'report', history: await db.listHistory() })
}
