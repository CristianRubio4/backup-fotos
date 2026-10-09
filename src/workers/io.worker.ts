import * as Comlink from 'comlink'
import exifr from 'exifr'
import { hashStream } from '../core/hash'
import { CancelledError, type ProgressFn, type RunControl } from '../core/types'

// Worker de E/S: hashes, copia en streaming y lectura de EXIF, fuera del hilo
// de la interfaz. La pausa y la cancelación llegan por mensajes y se
// comprueban entre bloques.

let paused = false
let cancelled = false

const control: RunControl = {
  get paused() {
    return paused
  },
  get cancelled() {
    return cancelled
  },
  async checkpoint() {
    while (paused && !cancelled) await new Promise((r) => setTimeout(r, 150))
    if (cancelled) throw new CancelledError()
  },
}

/** Agrupa el progreso para no enviar un mensaje por cada bloque. */
function throttled(onProgress: ProgressFn) {
  let acc = 0
  let last = 0
  const fn = (n: number) => {
    acc += n
    const t = Date.now()
    if (t - last > 100 || acc > 8 * 1024 * 1024) {
      onProgress(acc)
      acc = 0
      last = t
    }
  }
  fn.flush = () => {
    if (acc) onProgress(acc)
    acc = 0
  }
  return fn
}

async function withProgress<T>(onProgress: ProgressFn, job: (p: ProgressFn) => Promise<T>) {
  const p = throttled(onProgress)
  try {
    return await job(p)
  } finally {
    p.flush()
  }
}

const api = {
  setPaused(value: boolean) {
    paused = value
  },
  cancel() {
    cancelled = true
  },
  reset() {
    paused = false
    cancelled = false
  },

  hashBlob(file: Blob, onProgress: ProgressFn) {
    return withProgress(onProgress, (p) => hashStream(file.stream(), p, control))
  },

  async hashHandle(handle: FileSystemFileHandle, onProgress: ProgressFn) {
    const file = await handle.getFile()
    return withProgress(onProgress, (p) => hashStream(file.stream(), p, control))
  },

  /**
   * Copia en streaming calculando el hash de lo leído. createWritable()
   * escribe en un archivo temporal y solo lo hace visible en close(); si algo
   * falla se llama a abort() y no queda un archivo a medias.
   */
  async copy(file: Blob, handle: FileSystemFileHandle, onProgress: ProgressFn) {
    const writable = await handle.createWritable({ keepExistingData: false })
    try {
      const hash = await withProgress(onProgress, (p) => hashStream(file.stream(), p, control, writable))
      await writable.close()
      return hash
    } catch (err) {
      await writable.abort().catch(() => {})
      throw err
    }
  },

  /** Fecha de captura del EXIF (null si no hay). Solo lee el principio del archivo. */
  async readExif(file: Blob): Promise<Date | null> {
    const head = await file.slice(0, 512 * 1024).arrayBuffer()
    const data = await exifr.parse(head, { pick: ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized'] })
    const d = data?.DateTimeOriginal ?? data?.CreateDate ?? data?.DateTimeDigitized
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
  },
}

export type IoApi = typeof api

Comlink.expose(api)
