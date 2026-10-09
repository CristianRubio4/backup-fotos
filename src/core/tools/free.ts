import type { EntryStatus, ManifestEntry } from '../manifest/schema'
import type { ManifestStore } from '../manifest/store'
import type { Hasher, HashCache, RunControl, SourceFile, Target } from '../types'
import type { ToolProgress } from './integrity'

/** Lo que se sabe de cada disco registrado (índice guardado tras cada backup/comprobación). */
export interface KnownDisk {
  name: string
  statuses: Map<string, EntryStatus>
}

export interface FreeCandidate {
  file: SourceFile
  hash: string
  entry: ManifestEntry
  /** Discos en los que está con estado "verificado" (incluido el conectado). */
  disks: string[]
}

export interface FreeScan {
  candidates: FreeCandidate[]
  /** En el backup, pero "no verificado": nunca se ofrecen. */
  unverified: SourceFile[]
  /** Posibles versiones reducidas: nunca se ofrecen (el original puede estar solo en la nube). */
  reduced: SourceFile[]
  /** No están en el backup del disco conectado. */
  notBackedUp: number
}

/**
 * Busca en el origen los archivos que se pueden borrar con seguridad: están
 * en el manifest del disco conectado con estado "verificado" (hash
 * comprobado tras la copia). Indica en cuántos discos distintos están.
 */
export async function findFreeable(opts: {
  files: SourceFile[]
  store: ManifestStore
  activeDiskName: string
  otherDisks: KnownDisk[]
  hasher: Hasher
  cache?: HashCache
  control: RunControl
  onProgress?: (p: ToolProgress) => void
}): Promise<FreeScan> {
  const { store, control } = opts
  const scan: FreeScan = { candidates: [], unverified: [], reduced: [], notBackedUp: 0 }
  let done = 0
  for (const f of opts.files) {
    await control.checkpoint()
    opts.onProgress?.({ done: done++, total: opts.files.length, current: f.relPath })
    // Comparar primero por tamaño: si ningún archivo del backup mide eso, no está.
    if (!store.hasSize(f.size)) {
      scan.notBackedUp++
      continue
    }
    let hash = await opts.cache?.get(f)
    if (!hash) {
      hash = await opts.hasher.hash(await f.getFile(), () => {}, control)
      await opts.cache?.set(f, hash)
    }
    const entry = store.findByHash(hash)
    if (!entry) scan.notBackedUp++
    else if (entry.status === 'reduced') scan.reduced.push(f)
    else if (entry.status !== 'verified') scan.unverified.push(f)
    else {
      const disks = [opts.activeDiskName, ...opts.otherDisks.filter((d) => d.statuses.get(hash) === 'verified').map((d) => d.name)]
      scan.candidates.push({ file: f, hash, entry, disks })
    }
  }
  opts.onProgress?.({ done, total: opts.files.length, current: null })
  return scan
}

export interface FreeResult {
  deleted: FreeCandidate[]
  skipped: Array<{ candidate: FreeCandidate; reason: string }>
  bytes: number
}

/**
 * Borra del origen los candidatos confirmados. Justo antes de borrar cada
 * uno vuelve a comprobar que la copia del disco y el original siguen
 * coincidiendo con el hash; si algo no cuadra, no lo borra.
 */
export async function freeFiles(opts: {
  candidates: FreeCandidate[]
  target: Target
  hasher: Hasher
  remove: (c: FreeCandidate) => Promise<void>
  control: RunControl
  onDeleted?: (c: FreeCandidate) => Promise<void>
  onProgress?: (p: ToolProgress) => void
}): Promise<FreeResult> {
  const result: FreeResult = { deleted: [], skipped: [], bytes: 0 }
  let done = 0
  for (const c of opts.candidates) {
    await opts.control.checkpoint()
    opts.onProgress?.({ done: done++, total: opts.candidates.length, current: c.file.relPath })
    try {
      const onDisk = await opts.target.hash(c.entry.diskPath, () => {}, opts.control)
      if (onDisk !== c.hash) {
        result.skipped.push({ candidate: c, reason: onDisk ? 'la copia del disco ya no coincide (¿dañada?)' : 'la copia ya no está en el disco' })
        continue
      }
      const original = await opts.hasher.hash(await c.file.getFile(), () => {}, opts.control)
      if (original !== c.hash) {
        result.skipped.push({ candidate: c, reason: 'el original ha cambiado desde el backup' })
        continue
      }
      await opts.remove(c)
      result.deleted.push(c)
      result.bytes += c.file.size
      await opts.onDeleted?.(c)
    } catch (err) {
      if ((err as Error)?.name === 'CancelledError') throw err
      result.skipped.push({ candidate: c, reason: (err as Error).message })
    }
  }
  opts.onProgress?.({ done, total: opts.candidates.length, current: null })
  return result
}
