import { incorporateDiskFiles, type IncorporateResult } from '../backup/incorporate'
import { MANIFEST_FILE, type ManifestEntry } from '../manifest/schema'
import { ManifestStore } from '../manifest/store'
import type { Hasher, HashCache, ProgressFn, RunControl, SourceFile, Target } from '../types'

export interface ToolProgress {
  done: number
  total: number
  current: string | null
}

export interface CheckResult {
  checked: number
  ok: number
  /** Registrados en el manifest pero ya no están en el disco. */
  missing: ManifestEntry[]
  /** Su contenido ya no coincide con el hash registrado. */
  damaged: ManifestEntry[]
}

/**
 * Comprobar disco: recalcula el hash de todo lo guardado y lo compara con el
 * manifest.
 */
export async function checkIntegrity(opts: {
  target: Target
  store: ManifestStore
  control: RunControl
  onProgress?: (p: ToolProgress) => void
  onBytes?: ProgressFn
}): Promise<CheckResult> {
  const { target, store, control } = opts
  const entries = store.entries()
  const result: CheckResult = { checked: 0, ok: 0, missing: [], damaged: [] }
  for (const e of entries) {
    await control.checkpoint()
    opts.onProgress?.({ done: result.checked, total: entries.length, current: e.diskPath })
    const st = await target.stat(e.diskPath)
    if (!st) result.missing.push(e)
    else if (st.size !== e.size) result.damaged.push(e)
    else if ((await target.hash(e.diskPath, opts.onBytes ?? (() => {}), control)) !== e.hash) result.damaged.push(e)
    else result.ok++
    result.checked++
  }
  opts.onProgress?.({ done: result.checked, total: entries.length, current: null })
  return result
}

/** Dónde se puede encontrar una copia buena de un archivo. */
export interface RepairSource {
  label: string
  /** Devuelve el contenido si lo tiene (con ese hash), o null. */
  find(entry: ManifestEntry): Promise<Blob | null>
}

/**
 * Busca en las carpetas de origen archivos con el hash dado (primero por
 * tamaño, luego hash, usando la caché).
 */
export function sourcesRepairSource(files: SourceFile[], hasher: Hasher, cache: HashCache | undefined, control: RunControl): RepairSource {
  const bySize = new Map<number, SourceFile[]>()
  for (const f of files) bySize.set(f.size, [...(bySize.get(f.size) ?? []), f])
  return {
    label: 'carpetas de origen',
    async find(entry) {
      for (const f of bySize.get(entry.size) ?? []) {
        let h = await cache?.get(f)
        if (!h) {
          h = await hasher.hash(await f.getFile(), () => {}, control)
          await cache?.set(f, h)
        }
        if (h === entry.hash) return f.getFile()
      }
      return null
    },
  }
}

/** Otro disco de backup conectado que tiene ese archivo (y está bien). */
export async function diskRepairSource(label: string, target: Target, diskId: string, control: RunControl): Promise<RepairSource> {
  const { store } = await ManifestStore.open(target, diskId)
  return {
    label,
    async find(entry) {
      const other = store.findByHash(entry.hash)
      if (!other) return null
      if ((await target.hash(other.diskPath, () => {}, control)) !== entry.hash) return null
      return target.readFile(other.diskPath)
    },
  }
}

export interface RepairResult {
  repaired: Array<{ entry: ManifestEntry; from: string }>
  notFound: ManifestEntry[]
  failed: Array<{ entry: ManifestEntry; error: string }>
}

/** Vuelve a copiar archivos dañados o desaparecidos desde el origen u otro disco, y lo verifica. */
export async function repairEntries(opts: {
  target: Target
  store: ManifestStore
  entries: ManifestEntry[]
  sources: RepairSource[]
  control: RunControl
  onProgress?: (p: ToolProgress) => void
  onBytes?: ProgressFn
  now?: () => Date
}): Promise<RepairResult> {
  const { target, store, control } = opts
  const now = opts.now ?? (() => new Date())
  const result: RepairResult = { repaired: [], notFound: [], failed: [] }
  let done = 0
  for (const entry of opts.entries) {
    await control.checkpoint()
    opts.onProgress?.({ done: done++, total: opts.entries.length, current: entry.diskPath })
    let found: { blob: Blob; from: string } | null = null
    for (const s of opts.sources) {
      const blob = await s.find(entry).catch(() => null)
      if (blob) {
        found = { blob, from: s.label }
        break
      }
    }
    if (!found) {
      result.notFound.push(entry)
      continue
    }
    try {
      const copied = await target.copyIn(entry.diskPath, found.blob, opts.onBytes ?? (() => {}), control)
      const back = await target.hash(entry.diskPath, () => {}, control)
      if (copied !== entry.hash || back !== entry.hash) throw new Error('la copia nueva no coincide con el hash registrado')
      store.annotate(entry.hash, { status: 'verified', note: `Recuperado desde ${found.from} el ${now().toLocaleDateString('es-ES')}` })
      result.repaired.push({ entry, from: found.from })
    } catch (err) {
      result.failed.push({ entry, error: (err as Error).message })
    }
  }
  if (result.repaired.length) await store.compact(now())
  opts.onProgress?.({ done, total: opts.entries.length, current: null })
  return result
}

/**
 * Reconstruir manifest: cuando el manifest y su copia están dañados o se han
 * perdido. Guarda una copia del manifest dañado, escanea el disco y registra
 * todo lo que encuentra (con su hash).
 */
export async function rebuildManifest(opts: {
  target: Target
  diskId: string
  control: RunControl
  includeAll?: boolean
  onProgress?: (p: ToolProgress) => void
  onBytes?: ProgressFn
  now?: () => Date
}): Promise<IncorporateResult & { total: number }> {
  const now = opts.now ?? (() => new Date())
  const damaged = await opts.target.readText(MANIFEST_FILE)
  if (damaged !== null) {
    const stamp = now().toISOString().replace(/[:.]/g, '-')
    await opts.target.writeText(`.backup-manifest.danado-${stamp}.json`, damaged)
  }
  const { store } = await ManifestStore.open(opts.target, opts.diskId, now(), { ignoreCorrupt: true })
  const r = await incorporateDiskFiles({ target: opts.target, store, control: opts.control, onProgress: opts.onProgress, onBytes: opts.onBytes, includeAll: opts.includeAll, now })
  await store.compact(now())
  return { ...r, total: store.size }
}
