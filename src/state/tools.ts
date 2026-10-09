import { create } from 'zustand'
import { incorporateDiskFiles, type IncorporateResult } from '../core/backup/incorporate'
import { SpeedMeter } from '../core/backup/progress'
import { Controller } from '../core/control'
import { friendlyError } from '../core/errors'
import type { ManifestEntry } from '../core/manifest/schema'
import { ManifestStore } from '../core/manifest/store'
import { sanitizeName, withSuffix } from '../core/naming'
import {
  checkIntegrity,
  diskRepairSource,
  rebuildManifest,
  repairEntries,
  sourcesRepairSource,
  type CheckResult,
  type RepairResult,
  type RepairSource,
  type ToolProgress,
} from '../core/tools/integrity'
import { CancelledError, type ProgressFn, type SourceFile } from '../core/types'
import { db, type DiskRecord } from '../db'
import { ensurePermission } from '../platform/capabilities'
import { FsaTarget } from '../platform/fsa-target'
import { io, workerHasher } from '../platform/io'
import { keepScreenOn } from '../platform/power'
import { walkSource } from '../platform/walk'
import { activeDisk, saveDiskIndex, useApp, withBackupLock } from './app'
import { diskTarget, isLocked } from './keys'

export type ToolKind = 'check' | 'repair' | 'rebuild' | 'incorporate' | 'restore' | 'free-scan' | 'free-delete'

export interface ToolJob {
  kind: ToolKind
  label: string
  progress: ToolProgress
  bytes: number
  bytesPerSec: number
}

export interface RestoreResult {
  folder: string
  restored: number
  failed: Array<{ path: string; error: string }>
}

interface ToolsState {
  job: ToolJob | null
  error: string | null
  check: { diskKey: string; result: CheckResult } | null
  repair: RepairResult | null
  rebuild: (IncorporateResult & { total: number }) | null
  incorporate: IncorporateResult | null
  restore: RestoreResult | null
  runCheck(): Promise<void>
  runRepair(): Promise<void>
  runRebuild(): Promise<void>
  runIncorporate(): Promise<void>
  runRestore(entries: ManifestEntry[]): Promise<void>
  /** Restaurar/descifrar: todo el disco cifrado a una carpeta. */
  runDecryptAll(): Promise<void>
  cancel(): void
}

let ctl: Controller | null = null

/** Disco activo listo para usarlo: conectado y, si está cifrado, desbloqueado. */
export function readyDisk(): DiskRecord {
  const d = activeDisk()
  const status = d && useApp.getState().diskStates[d.key]
  if (!d || status?.state !== 'connected') throw new Error('Conecta el disco de backup (y permite el acceso) para usar esta herramienta.')
  if (!d.diskId && status.id) {
    void useApp.getState().updateDisk(d.key, { diskId: status.id })
    return { ...d, diskId: status.id }
  }
  if (!d.diskId) throw new Error('Este disco aún no tiene identificador: haz un backup en él o vuelve a añadirlo.')
  if (d.encrypted && isLocked(d)) throw new Error('Este disco está cifrado: desbloquéalo con su contraseña en Inicio.')
  return d
}

/** Ejecuta una herramienta con bloqueo, pantalla encendida, progreso y cancelación. */
export async function runTool(kind: ToolKind, label: string, fn: (c: Controller, onProgress: (p: ToolProgress) => void, onBytes: ProgressFn) => Promise<void>) {
  if (useApp.getState().running || useTools.getState().job) return
  useTools.setState({ error: null })
  await withBackupLock(async () => {
    const c = new Controller()
    ctl = c
    await io.reset()
    keepScreenOn(true)
    const meter = new SpeedMeter()
    const job: ToolJob = { kind, label, progress: { done: 0, total: 0, current: null }, bytes: 0, bytesPerSec: 0 }
    useTools.setState({ job: { ...job } })
    let last = 0
    const push = () => {
      const t = Date.now()
      if (t - last < 150) return
      last = t
      meter.sample(t, job.bytes)
      job.bytesPerSec = meter.rate()
      useTools.setState({ job: { ...job, progress: { ...job.progress } } })
    }
    try {
      await fn(
        c,
        (p) => {
          job.progress = p
          push()
        },
        (n) => {
          job.bytes += n
          push()
        },
      )
    } catch (err) {
      if (!(err instanceof CancelledError) && (err as Error)?.name !== 'CancelledError') {
        useTools.setState({ error: (err as Error).message ?? String(err) })
      }
    } finally {
      keepScreenOn(false)
      ctl = null
      useTools.setState({ job: null })
    }
  })
}

async function openStore(d: DiskRecord) {
  return (await ManifestStore.open(diskTarget(d), d.diskId!)).store
}

/** Todos los archivos de las carpetas de origen con permiso (para reparar o liberar espacio). */
export async function scanSources(c: Controller, mode: 'read' | 'readwrite' = 'read', exclude: FileSystemDirectoryHandle | null = null) {
  const files: SourceFile[] = []
  const skipped: string[] = []
  for (const s of useApp.getState().sources) {
    try {
      const perm = await ensurePermission(s.handle, mode, true)
      if (perm !== 'granted') {
        skipped.push(s.name)
        continue
      }
      const r = await walkSource(s.handle, exclude, c, () => {}, { label: s.name, cacheKeyPrefix: s.key })
      files.push(...r.files)
    } catch (err) {
      if ((err as Error)?.name === 'CancelledError') throw err
      // Carpeta no accesible (p. ej. móvil desconectado): se sigue con las demás.
      skipped.push(`${s.name} (${friendlyError(err)})`)
    }
  }
  return { files, skipped }
}

export const useTools = create<ToolsState>((set, get) => ({
  job: null,
  error: null,
  check: null,
  repair: null,
  rebuild: null,
  incorporate: null,
  restore: null,

  async runCheck() {
    let disk: DiskRecord
    try {
      disk = readyDisk()
    } catch (err) {
      return set({ error: (err as Error).message })
    }
    set({ check: null, repair: null })
    await runTool('check', `Comprobando ${disk.name}`, async (c, onProgress, onBytes) => {
      const result = await checkIntegrity({ target: diskTarget(disk), store: await openStore(disk), control: c, onProgress, onBytes })
      set({ check: { diskKey: disk.key, result } })
      if (result.checked === result.ok + result.missing.length + result.damaged.length) {
        await useApp.getState().updateDisk(disk.key, { lastCheckAt: new Date().toISOString() })
      }
    })
  },

  async runRepair() {
    const check = get().check
    let disk: DiskRecord
    try {
      disk = readyDisk()
    } catch (err) {
      return set({ error: (err as Error).message })
    }
    if (!check || check.diskKey !== disk.key) return
    const entries = [...check.result.missing, ...check.result.damaged]
    await runTool('repair', 'Volviendo a copiar archivos', async (c, onProgress, onBytes) => {
      onProgress({ done: 0, total: entries.length, current: 'Buscando en las carpetas de origen…' })
      const { files } = await scanSources(c, 'read', disk.handle)
      const sources: RepairSource[] = [sourcesRepairSource(files, workerHasher, db.hashCache(), c)]
      // Otros discos de backup conectados
      const { disks, diskStates } = useApp.getState()
      for (const other of disks) {
        if (other.key === disk.key || !other.diskId || diskStates[other.key]?.state !== 'connected' || (other.encrypted && isLocked(other))) continue
        sources.push(await diskRepairSource(`el disco ${other.name}`, diskTarget(other), other.diskId, c).catch(() => ({ label: other.name, find: async () => null })))
      }
      const result = await repairEntries({ target: diskTarget(disk), store: await openStore(disk), entries, sources, control: c, onProgress, onBytes })
      set({ repair: result })
      await saveDiskIndex(disk)
    })
  },

  async runRebuild() {
    let disk: DiskRecord
    try {
      disk = readyDisk()
    } catch (err) {
      return set({ error: (err as Error).message })
    }
    set({ rebuild: null })
    await runTool('rebuild', 'Reconstruyendo el manifest', async (c, onProgress, onBytes) => {
      const r = await rebuildManifest({ target: diskTarget(disk), diskId: disk.diskId!, control: c, includeAll: !!disk.encrypted, onProgress, onBytes })
      set({ rebuild: r })
      await saveDiskIndex(disk)
    })
  },

  async runIncorporate() {
    let disk: DiskRecord
    try {
      disk = readyDisk()
    } catch (err) {
      return set({ error: (err as Error).message })
    }
    set({ incorporate: null })
    await runTool('incorporate', 'Buscando archivos sueltos en el disco', async (c, onProgress, onBytes) => {
      const store = await openStore(disk)
      const r = await incorporateDiskFiles({ target: diskTarget(disk), store, control: c, onProgress, onBytes, includeAll: !!disk.encrypted })
      await store.compact()
      set({ incorporate: r })
      await saveDiskIndex(disk)
    })
  },

  async runDecryptAll() {
    let disk: DiskRecord
    try {
      disk = readyDisk()
    } catch (err) {
      return set({ error: (err as Error).message })
    }
    const entries = (await openStore(disk)).entries()
    if (!confirm(`Se descifrarán ${entries.length} archivos a la carpeta que elijas, con sus nombres originales y ordenados por año/mes. ¿Continuar?`)) return
    await get().runRestore(entries)
  },

  async runRestore(entries) {
    let disk: DiskRecord
    try {
      disk = readyDisk()
    } catch (err) {
      return set({ error: (err as Error).message })
    }
    let folder: FileSystemDirectoryHandle
    try {
      folder = await window.showDirectoryPicker({ id: 'backup-restaurar', mode: 'readwrite', startIn: 'pictures' })
    } catch {
      return
    }
    set({ restore: null })
    await runTool('restore', `Restaurando en ${folder.name}`, async (c, onProgress, onBytes) => {
      const src = diskTarget(disk)
      const dest = new FsaTarget(folder)
      const result: RestoreResult = { folder: folder.name, restored: 0, failed: [] }
      for (let i = 0; i < entries.length; i++) {
        await c.checkpoint()
        const e = entries[i]
        onProgress({ done: i, total: entries.length, current: e.originalName })
        try {
          const out = await freePath(dest, restorePath(e, !!disk.encrypted))
          const h = await src.exportTo(e.diskPath, dest, out, onBytes)
          if (h !== e.hash) throw new Error('el archivo restaurado no coincide con el registrado (puede estar dañado en el disco)')
          result.restored++
        } catch (err) {
          if (err instanceof CancelledError || (err as Error)?.name === 'CancelledError') throw err
          result.failed.push({ path: e.diskPath, error: (err as Error).message })
        }
      }
      onProgress({ done: entries.length, total: entries.length, current: null })
      set({ restore: result })
    })
  },

  cancel() {
    ctl?.cancel()
    void io.cancel()
  },
}))

/** Ruta al restaurar: la misma del disco; en discos cifrados (nombres aleatorios) se reconstruye año/mes/nombre original. */
export function restorePath(e: ManifestEntry, encrypted: boolean) {
  if (!encrypted) return e.diskPath
  const d = new Date(e.exifDate ?? e.fileDate)
  const dir = Number.isNaN(d.getTime()) ? 'Sin fecha' : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`
  return `${dir}/${sanitizeName(e.originalName || 'archivo')}`
}

/** Si ya existe un archivo con ese nombre en la carpeta de destino, añade sufijo (nunca se sobrescribe nada). */
async function freePath(dest: FsaTarget, path: string) {
  const slash = path.lastIndexOf('/')
  const dir = path.slice(0, slash + 1)
  const name = path.slice(slash + 1)
  for (let n = 0; ; n++) {
    const p = dir + withSuffix(name, n)
    if (!(await dest.stat(p))) return p
  }
}
