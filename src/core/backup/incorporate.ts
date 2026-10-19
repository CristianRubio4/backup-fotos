import type { ManifestStore } from '../manifest/store'
import { isMedia } from '../media'
import { mapPool } from '../pool'
import type { DiskFile, ProgressFn, RunControl, Target } from '../types'

const DATED_PREFIX = /^\d{4}-\d{2}-\d{2}_\d{6}_/

export interface IncorporateResult {
  /** Archivos del disco añadidos al manifest. */
  added: number
  /** Archivos del disco con el mismo contenido que otro ya registrado (copias repetidas en el disco). */
  duplicatesOnDisk: string[]
  /** Archivos que no se han podido leer. */
  unreadable: string[]
}

/**
 * Incorpora al manifest las fotos y vídeos que ya están en el disco pero no
 * figuran en él: copiados a mano, con otra herramienta, extraídos de un ZIP
 * del modo compatible, o tras perder el manifest. Calcula el hash de cada
 * uno releyéndolo del disco, así que quedan como "verificados".
 */
export async function incorporateDiskFiles(opts: {
  target: Target
  store: ManifestStore
  control: RunControl
  onProgress?: (p: { done: number; total: number; current: string | null }) => void
  onBytes?: ProgressFn
  /** Se llama con el total de bytes a releer, antes de empezar. */
  onPlanned?: (files: number, bytes: number) => void
  /** Incluir cualquier archivo (discos cifrados: .bin), no solo fotos y vídeos. */
  includeAll?: boolean
  /** Solo los archivos de estos tamaños (los únicos que pueden coincidir con lo que se va a copiar). */
  sizes?: Set<number>
  /** Archivos que se releen a la vez. */
  concurrency?: number
  now?: () => Date
}): Promise<IncorporateResult> {
  const { target, store, control } = opts
  const now = opts.now ?? (() => new Date())
  const pending: DiskFile[] = []
  let seen = 0
  for await (const f of target.walkFiles((p) => (opts.includeAll || isMedia(p)) && !store.hasDiskPath(p))) {
    await control.checkpoint()
    if (++seen % 200 === 0) opts.onProgress?.({ done: 0, total: 0, current: f.path })
    if (f.size > 0 && (!opts.sizes || opts.sizes.has(f.size))) pending.push(f)
  }
  opts.onPlanned?.(pending.length, pending.reduce((a, f) => a + f.size, 0))

  const result: IncorporateResult = { added: 0, duplicatesOnDisk: [], unreadable: [] }
  let done = 0
  // Releer es lo lento: varios a la vez (cada uno en un Worker). El registro se hace en orden.
  const hashes = await mapPool(pending, Math.max(1, opts.concurrency ?? 1), async (f) => {
    await control.checkpoint()
    const hash = await target.hash(f.path, opts.onBytes ?? (() => {}), control).catch((err) => {
      if ((err as Error)?.name === 'CancelledError') throw err
      return null
    })
    opts.onProgress?.({ done: ++done, total: pending.length, current: f.path })
    return hash
  })
  for (let i = 0; i < pending.length; i++) {
    const f = pending[i]
    const hash = hashes[i]
    if (!hash) {
      result.unreadable.push(f.path)
      continue
    }
    if (store.findByHash(hash)) {
      result.duplicatesOnDisk.push(f.path)
      continue
    }
    const name = f.path.split('/').pop()!
    store.add({
      hash,
      size: f.size,
      originalName: name.replace(DATED_PREFIX, ''),
      sourcePath: '',
      diskPath: f.path,
      exifDate: null,
      fileDate: new Date(f.lastModified || now().getTime()).toISOString(),
      deviceId: 'disco',
      deviceName: 'Ya estaba en el disco',
      status: 'verified',
      note: 'Incorporado: ya estaba en el disco antes de usar la app',
      copiedAt: now().toISOString(),
    })
    result.added++
  }
  opts.onProgress?.({ done, total: pending.length, current: null })
  return result
}
