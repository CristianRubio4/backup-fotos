import * as Comlink from 'comlink'
import { CancelledError, type ExifReader, type Hasher, type ProgressFn } from '../core/types'
import type { IoApi } from '../workers/io.worker'

const worker = new Worker(new URL('../workers/io.worker.ts', import.meta.url), { type: 'module' })
const remote = Comlink.wrap<IoApi>(worker)

/** Los errores del Worker llegan como Error genérico: se recupera CancelledError. */
async function call<T>(job: Promise<T>): Promise<T> {
  try {
    return await job
  } catch (err) {
    if ((err as Error)?.name === 'CancelledError') throw new CancelledError()
    throw err
  }
}

export const io = {
  setPaused: (v: boolean) => remote.setPaused(v),
  cancel: () => remote.cancel(),
  reset: () => remote.reset(),
  hashBlob: (file: Blob, onProgress: ProgressFn) => call(remote.hashBlob(file, Comlink.proxy(onProgress))),
  hashHandle: (h: FileSystemFileHandle, onProgress: ProgressFn) => call(remote.hashHandle(h, Comlink.proxy(onProgress))),
  copy: (file: Blob, h: FileSystemFileHandle, onProgress: ProgressFn) => call(remote.copy(file, h, Comlink.proxy(onProgress))),
  readExif: (file: Blob) => remote.readExif(file),
  inspect: (file: Blob, opts: Parameters<IoApi['inspect']>[1]) => remote.inspect(file, opts),
  heicThumbnail: (file: Blob, size: number) => remote.heicThumbnail(file, size),
}

/** La pausa/cancelación del motor se reenvía al Worker (ver BackupStore). */
export const workerHasher: Hasher = {
  hash: (file, onProgress) => io.hashBlob(file, onProgress),
}

export const workerExif: ExifReader = (file) => io.readExif(file)
