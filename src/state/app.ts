import { create } from 'zustand'
import { runBackup, type BackupReport } from '../core/backup/engine'
import type { Progress } from '../core/backup/progress'
import { Controller } from '../core/control'
import { DISK_ID_FILE } from '../core/disk'
import { DEFAULT_SETTINGS, type Device, type Settings } from '../core/settings'
import { db, type HistoryRecord } from '../db'
import { capabilities, ensurePermission } from '../platform/capabilities'
import { FsaTarget } from '../platform/fsa-target'
import { io, workerExif, workerHasher } from '../platform/io'
import { isInside, walkSource } from '../platform/walk'

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

  init(): Promise<void>
  go(screen: Screen): void
  chooseSource(): Promise<void>
  chooseDest(): Promise<void>
  grant(which: 'source' | 'dest'): Promise<void>
  start(): Promise<void>
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
    } catch (err) {
      if (!isAbort(err)) set({ notice: `No se pudo elegir la carpeta: ${(err as Error).message}` })
    }
  },

  async grant(which) {
    const h = which === 'source' ? get().source : get().dest
    if (!h) return
    const state = await ensurePermission(h, which === 'source' ? 'read' : 'readwrite', true)
    if (which === 'source') set({ sourcePerm: state })
    else set({ destPerm: state, diskName: state === 'granted' ? await readDiskName(h) : get().diskName })
  },

  async start() {
    const { source, dest, running } = get()
    if (running || !source || !dest || !capabilities.fsAccess) return

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

    const job = () => runJob(source, dest)
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
    set({ paused: false })
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

async function runJob(source: FileSystemDirectoryHandle, dest: FileSystemDirectoryHandle) {
  const { settings, device } = useApp.getState()
  const ctl = new Controller()
  controller = ctl
  await io.reset()
  useApp.setState({ running: true, paused: false, progress: null, report: null, screen: 'progress' })
  window.addEventListener('beforeunload', onBeforeUnload)

  const target = new FsaTarget(dest)
  let report: BackupReport
  try {
    report = await runBackup({
      target,
      diskName: dest.name,
      scan: (onFound) => walkSource(source, dest, ctl, onFound),
      hasher: workerHasher,
      readExif: workerExif,
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
    useApp.setState({ running: false, screen: 'home', notice: `Error inesperado: ${(err as Error).message}` })
    return
  } finally {
    window.removeEventListener('beforeunload', onBeforeUnload)
    document.title = BASE_TITLE
    controller = null
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
    errors: report.errors.length,
    bytesCopied: report.bytesCopied,
  })
  useApp.setState({ running: false, paused: false, report, diskName, screen: 'report', history: await db.listHistory() })
}
