import * as Comlink from 'comlink'
import exifr from 'exifr'
import type { Features } from '../core/analysis/classify'
import { blobSource, byteFeatures, DECODABLE_IMAGES } from '../core/analysis/formats'
import { createEncryption, unlock, type DiskKeys, type EncryptionParams } from '../core/crypto'
import { decryptCopy, encryptCopy } from '../core/crypto-io'
import { hashStream } from '../core/hash'
import { CancelledError, type ExifInfo, type ProgressFn, type RunControl } from '../core/types'
import { decodeHeif, decodeWithBrowser, heicThumbnail } from './image-analysis'

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

  // ---- Discos cifrados ----

  /** Copia cifrando; devuelve el hash del contenido original. */
  async copyEncrypted(file: Blob, handle: FileSystemFileHandle, keys: DiskKeys, onProgress: ProgressFn) {
    const writable = await handle.createWritable({ keepExistingData: false })
    try {
      const hash = await withProgress(onProgress, (p) => encryptCopy(keys, file, writable, p, control))
      await writable.close()
      return hash
    } catch (err) {
      await writable.abort().catch(() => {})
      throw err
    }
  },

  /** Hash del contenido original de un archivo cifrado (lo descifra al vuelo, sin guardarlo). */
  async hashEncrypted(handle: FileSystemFileHandle, keys: DiskKeys, onProgress: ProgressFn) {
    const file = await handle.getFile()
    return withProgress(onProgress, (p) => decryptCopy(keys, file, null, p, control))
  },

  /** Restaurar: descifra un archivo del disco a otra carpeta. */
  async decryptTo(src: FileSystemFileHandle, dest: FileSystemFileHandle, keys: DiskKeys, onProgress: ProgressFn) {
    const file = await src.getFile()
    const writable = await dest.createWritable({ keepExistingData: false })
    try {
      const hash = await withProgress(onProgress, (p) => decryptCopy(keys, file, writable, p, control))
      await writable.close()
      return hash
    } catch (err) {
      await writable.abort().catch(() => {})
      throw err
    }
  },

  /** Argon2id es lento a propósito (~1 s): se hace aquí para no bloquear la interfaz. */
  createEncryption(password: string) {
    return createEncryption(password)
  },
  unlock(password: string, params: EncryptionParams) {
    return unlock(password, params)
  },

  /** Fecha de captura y dimensiones del EXIF. Solo lee el principio del archivo. */
  async readExif(file: Blob): Promise<ExifInfo> {
    const head = await file.slice(0, 512 * 1024).arrayBuffer()
    const data = await exifr.parse(head, {
      pick: ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'ExifImageWidth', 'ExifImageHeight', 'PixelXDimension', 'PixelYDimension'],
    })
    const d = data?.DateTimeOriginal ?? data?.CreateDate ?? data?.DateTimeDigitized
    const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined)
    return {
      date: d instanceof Date && !Number.isNaN(d.getTime()) ? d : null,
      width: num(data?.ExifImageWidth ?? data?.PixelXDimension),
      height: num(data?.ExifImageHeight ?? data?.PixelYDimension),
    }
  },

  heicThumbnail(file: Blob, size: number) {
    return heicThumbnail(file, size)
  },

  /**
   * Medidas de un archivo que se pueden tomar en el Worker: bytes
   * (formato, truncado, estructura) y decodificación de imágenes.
   */
  async inspect(file: Blob, opts: { media: 'image' | 'video'; heifDecode: boolean; wantBlur: boolean }) {
    const bytes = await byteFeatures(blobSource(file))
    const out: Pick<Features, 'bytes' | 'decode' | 'heifUnavailable'> = { bytes }
    if (opts.media !== 'image') return out
    if (DECODABLE_IMAGES.includes(bytes.kind)) {
      out.decode = await decodeWithBrowser(file, opts.wantBlur)
    } else if (bytes.kind === 'heif' && opts.heifDecode) {
      const d = await decodeHeif(file, opts.wantBlur)
      if (d === 'unavailable') out.heifUnavailable = true
      else out.decode = d
    }
    return out
  },
}

export type IoApi = typeof api

Comlink.expose(api)
