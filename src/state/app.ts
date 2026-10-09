import { create } from 'zustand'
import { runBackup, type BackupReport } from '../core/backup/engine'
import { mergeForced } from '../core/backup/report'
import type { Progress } from '../core/backup/progress'
import { Controller } from '../core/control'
import { DISK_ID_FILE } from '../core/disk'
import { DEFAULT_SETTINGS, type Device, type Settings } from '../core/settings'
import { db, type HistoryRecord } from '../db'
import { CancelledError, type SourceFile } from '../core/types'
import { createAnalyzer } from '../platform/analyzer'
import { capabilities, ensurePermission } from '../platform/capabilities'
import { checkDisk, DISK_POLL_MS, type DiskStatus } from '../platform/disk-monitor'
import { FsaTarget } from '../platform/fsa-target'
import { io, workerExif, workerHasher } from '../platform/io'
import { BATTERY_PAUSE, BATTERY_WARN, keepScreenOn, readBattery, watchBattery, type BatteryInfo, type WakeState } from '../platform/power'
import { isInside, walkSource } from '../platform/walk'

/** Por qué está esperando un backup interrumpido por el disco. */
export type WaitReason = 'disconnected' | 'needs-permission' | 'other-disk'

export type Screen = 'home' | 'progress' | 'report' | 'history' | 'settings' | 'help'

interface AppState {
  ready: boolean
  screen: Screen
  source: FileSystemDirectoryHandle | null
  sourcePerm: PermissionState | null
  dest: FileSystemDirectoryHandle | null
  destPerm: PermissionState | null
  diskName: string | null
  settings: Settings
  device: Device
  history: HistoryRecord[]
  running: boolean
  paused: boolean
  progress: Progress | null
  report: BackupReport | null
  notice: string | null
  /** Estado del disco, comprobado cada 3 s. */
  diskStatus: DiskStatus
  waitReason: WaitReason | null
  wake: WakeState
  battery: BatteryInfo | null
  /** Pausado automáticamente por batería baja. */
  batteryPaused: boolean

  init(): Promise<void>
  go(screen: Screen): void
  chooseSource(): Promise<void>
  chooseDest(): Promise<void>
  grant(which: 'source' | 'dest'): Promise<void>
  /** Hace el backup; con `forcePaths`, copia solo esos descartados ("Copiar igualmente"). */
  start(forcePaths?: string[]): Promise<void>
  pause(): void
  resume(): void
  cancel(): void
  saveSettings(s: Settings): Promise<void>
  saveDevice(d: Device): Promise<void>
  dismissNotice(): void
}

let controller: Controller | null = null
const BASE_TITLE = 'Backup de fotos'

function isAbort(err: unknown) {
  return (err as Error)?.name === 'AbortError'
}

async function readDiskName(dest: FileSystemDirectoryHandle) {
  try {
    const text = await new FsaTarget(dest).readText(DISK_ID_FILE)
    if (text) return (JSON.parse(text).name as string) || dest.name
  } catch {
    // Sin permiso o archivo dañado: se usa el nombre de la carpeta.
  }
  return dest.name
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault()
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  screen: 'home',
  source: null,
  sourcePerm: null,
  dest: null,
  destPerm: null,
  diskName: null,
  settings: DEFAULT_SETTINGS,
  device: { id: '', name: '' },
  history: [],
  running: false,
  paused: false,
  progress: null,
  report: null,
  notice: null,
  diskStatus: { state: 'none' },
  waitReason: null,
  wake: 'off',
  battery: null,
  batteryPaused: false,

  async init() {
    const [source, dest, settings, device, history] = await Promise.all([
      db.getSource(),
      db.getDest(),
      db.getSettings(),
      db.getDevice(),
      db.listHistory(),
    ])
    const sourcePerm = source ? await source.queryPermission({ mode: 'read' }) : null
    const destPerm = dest ? await dest.queryPermission({ mode: 'readwrite' }) : null
    const diskName = dest && destPerm === 'granted' ? await readDiskName(dest) : (dest?.name ?? null)
    set({ ready: true, source: source ?? null, dest: dest ?? null, sourcePerm, destPerm, diskName, settings, device, history })
    startDiskPolling()
    void readBattery().then((battery) => set({ battery }))
  },

  go: (screen) => set({ screen }),
  dismissNotice: () => set({ notice: null }),

  async chooseSource() {
    try {
      const h = await window.showDirectoryPicker({ id: 'backup-origen', mode: 'read', startIn: 'pictures' })
      await db.setSource(h)
      set({ source: h, sourcePerm: 'granted' })
    } catch (err) {
      if (!isAbort(err)) set({ notice: `No se pudo elegir la carpeta: ${(err as Error).message}` })
    }
  },

  async chooseDest() {
    try {
      const h = await window.showDirectoryPicker({ id: 'backup-destino', mode: 'readwrite' })
      await db.setDest(h)
      set({ dest: h, destPerm: 'granted', diskName: await readDiskName(h) })
      void refreshDisk()
    } catch (err) {
      if (!isAbort(err)) set({ notice: `No se pudo elegir la carpeta: ${(err as Error).message}` })
    }
  },

  async grant(which) {
    const h = which === 'source' ? get().source : get().dest
    if (!h) return
    const state = await ensurePermission(h, which === 'source' ? 'read' : 'readwrite', true)
    if (which === 'source') set({ sourcePerm: state })
    else {
      set({ destPerm: state, diskName: state === 'granted' ? await readDiskName(h) : get().diskName })
      void refreshDisk()
    }
  },

  async start(forcePaths) {
    const { source, dest, running } = get()
    if (running || !source || !dest || !capabilities.fsAccess) return
    const force = forcePaths?.map((p) => lastScan.get(p)).filter((f): f is SourceFile => !!f)
    if (forcePaths && !force?.length) {
      set({ notice: 'Esos archivos ya no están disponibles en esta sesión. Vuelve a hacer el backup y cópialos desde el nuevo informe.' })
      return
    }

    // Primero los permisos: requestPermission necesita el clic del usuario.
    const sp = await ensurePermission(source, 'read', true)
    const dp = await ensurePermission(dest, 'readwrite', true)
    set({ sourcePerm: sp, destPerm: dp })
    if (sp !== 'granted' || dp !== 'granted') {
      set({ notice: 'Sin permiso de acceso a las carpetas no se puede hacer el backup.' })
      return
    }
    if (await isInside(dest, source)) {
      set({ notice: 'La carpeta de origen está dentro de la carpeta de backup. Elige otra carpeta de origen.' })
      return
    }
    const disk = await refreshDisk()
    if (disk.state !== 'connected') {
      set({ notice: 'El disco de destino no está conectado. Conéctalo y vuelve a intentarlo.' })
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

    const job = () => runJob(source, dest, force)
    if (!capabilities.webLocks) return job()
    // Web Locks: un solo backup a la vez entre pestañas y ventanas.
    await navigator.locks.request('backup-fotos', { ifAvailable: true }, async (lock) => {
      if (!lock) {
        set({ notice: 'Ya hay un backup en curso en otra pestaña o ventana. Espera a que termine.' })
        return
      }
      await job()
    })
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

let polling: ReturnType<typeof setInterval> | null = null
let checking = false

/** Comprueba ahora si el disco de destino está accesible. */
async function refreshDisk(): Promise<DiskStatus> {
  const status = await checkDisk(useApp.getState().dest)
  useApp.setState({ diskStatus: status })
  return status
}

/** Mientras la app está abierta, comprueba cada 3 s qué disco está conectado. */
function startDiskPolling() {
  if (polling) return
  const tick = async () => {
    if (checking) return
    checking = true
    try {
      await refreshDisk()
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
async function waitForDisk(dest: FileSystemDirectoryHandle, diskId: string, ctl: Controller) {
  for (;;) {
    if (ctl.cancelled) throw new CancelledError()
    const s = await checkDisk(dest)
    useApp.setState({ diskStatus: s })
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

/**
 * Ejecuta un backup. Con `force`, copia solo esos archivos (descartados que
 * el usuario quiere conservar) sin pasar por los filtros, y fusiona el
 * resultado con el informe actual.
 */
async function runJob(source: FileSystemDirectoryHandle, dest: FileSystemDirectoryHandle, force?: SourceFile[]) {
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

  const target = new FsaTarget(dest)
  let report: BackupReport
  try {
    report = await runBackup({
      target,
      diskName: dest.name,
      scan: force
        ? async () => ({ files: force, ignored: [] })
        : async (onFound) => {
            const result = await walkSource(source, dest, ctl, onFound)
            lastScan = new Map(result.files.map((f) => [f.relPath, f]))
            return result
          },
      hasher: workerHasher,
      readExif: workerExif,
      analyzer: createAnalyzer(settings.filters),
      force: force && new Set(force.map((f) => f.relPath)),
      waitForDisk: (diskId) => waitForDisk(dest, diskId, ctl),
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

  const diskName = await readDiskName(dest)
  await db.addHistory({
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    outcome: report.outcome,
    diskId: report.diskId,
    diskName,
    deviceName: device.name,
    copied: report.copied.length + report.alreadyOnDisk.length,
    duplicates: report.duplicates.length,
    discarded: report.discarded.length,
    unverified: report.unverified.length,
    errors: report.errors.length + report.fat32.length,
    bytesCopied: report.bytesCopied,
  })
  const shown = force && previous ? mergeForced(previous, report) : report
  useApp.setState({ running: false, paused: false, report: shown, diskName, screen: 'report', history: await db.listHistory() })
}
