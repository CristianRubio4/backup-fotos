import * as Comlink from 'comlink'
import type { DiskKeys, EncryptionParams } from '../core/crypto'
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
  copyEncrypted: (file: Blob, h: FileSystemFileHandle, keys: DiskKeys, onProgress: ProgressFn) => call(remote.copyEncrypted(file, h, keys, Comlink.proxy(onProgress))),
  hashEncrypted: (h: FileSystemFileHandle, keys: DiskKeys, onProgress: ProgressFn) => call(remote.hashEncrypted(h, keys, Comlink.proxy(onProgress))),
  decryptTo: (src: FileSystemFileHandle, dest: FileSystemFileHandle, keys: DiskKeys, onProgress: ProgressFn) => call(remote.decryptTo(src, dest, keys, Comlink.proxy(onProgress))),
  createEncryption: (password: string) => remote.createEncryption(password),
  unlock: (password: string, params: EncryptionParams) => remote.unlock(password, params),
}

/** La pausa/cancelación del motor se reenvía al Worker (ver BackupStore). */
export const workerHasher: Hasher = {
  hash: (file, onProgress) => io.hashBlob(file, onProgress),
}

export const workerExif: ExifReader = (file) => io.readExif(file)
