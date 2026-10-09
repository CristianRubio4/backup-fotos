import type { ManifestStore } from '../manifest/store'
import { isMedia } from '../media'
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
  now?: () => Date
}): Promise<IncorporateResult> {
  const { target, store, control } = opts
  const now = opts.now ?? (() => new Date())
  const pending: DiskFile[] = []
  for await (const f of target.walkFiles()) {
    await control.checkpoint()
    if (isMedia(f.path) && !store.hasDiskPath(f.path) && f.size > 0) pending.push(f)
  }
  opts.onPlanned?.(pending.length, pending.reduce((a, f) => a + f.size, 0))

  const result: IncorporateResult = { added: 0, duplicatesOnDisk: [], unreadable: [] }
  let done = 0
  for (const f of pending) {
    await control.checkpoint()
    opts.onProgress?.({ done, total: pending.length, current: f.path })
    const hash = await target.hash(f.path, opts.onBytes ?? (() => {}), control).catch(() => null)
    done++
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
