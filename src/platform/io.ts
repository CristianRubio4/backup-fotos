import * as Comlink from 'comlink'
import type { DiskKeys, EncryptionParams } from '../core/crypto'
import { CancelledError, type ExifReader, type Hasher, type ProgressFn } from '../core/types'
import type { IoApi } from '../workers/io.worker'

/**
 * Pool de Workers de E/S. Calcular hashes, decodificar imágenes y cifrar es
 * trabajo de CPU: con varios Workers se aprovechan los núcleos del
 * dispositivo. Se crean bajo demanda (el primero al arrancar, el resto
 * cuando hay trabajo en paralelo) y como mucho 4, para no agotar la memoria
 * del móvil (cada uno puede cargar libheif).
 */
export const POOL_SIZE = Math.max(1, Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 2) - 1 || 1))

interface Slot {
  remote: Comlink.Remote<IoApi>
  busy: number
}

const slots: Slot[] = []

function spawn(): Slot {
  const worker = new Worker(new URL('../workers/io.worker.ts', import.meta.url), { type: 'module', name: `io-${slots.length}` })
  const slot = { remote: Comlink.wrap<IoApi>(worker), busy: 0 }
  slots.push(slot)
  return slot
}

/** El Worker menos ocupado (crea uno nuevo si todos trabajan y aún cabe otro). */
function pick(): Slot {
  if (!slots.length) return spawn()
  const idle = slots.reduce((a, b) => (b.busy < a.busy ? b : a))
  if (idle.busy > 0 && slots.length < POOL_SIZE) return spawn()
  return idle
}

/** Ejecuta en un Worker del pool; los errores del Worker llegan genéricos: se recupera CancelledError. */
async function run<T>(job: (r: Comlink.Remote<IoApi>) => Promise<T>): Promise<T> {
  const slot = pick()
  slot.busy++
  try {
    return await job(slot.remote)
  } catch (err) {
    if ((err as Error)?.name === 'CancelledError') throw new CancelledError()
    throw err
  } finally {
    slot.busy--
  }
}

const all = (fn: (r: Comlink.Remote<IoApi>) => Promise<void>) => Promise.all((slots.length ? slots : [spawn()]).map((s) => fn(s.remote))).then(() => {})
const p = (fn: ProgressFn) => Comlink.proxy(fn)

export const io = {
  setPaused: (v: boolean) => all((r) => r.setPaused(v)),
  cancel: () => all((r) => r.cancel()),
  reset: () => all((r) => r.reset()),
  hashBlob: (file: Blob, onProgress: ProgressFn) => run((r) => r.hashBlob(file, p(onProgress))),
  hashHandle: (h: FileSystemFileHandle, onProgress: ProgressFn) => run((r) => r.hashHandle(h, p(onProgress))),
  copy: (file: Blob, h: FileSystemFileHandle, onProgress: ProgressFn) => run((r) => r.copy(file, h, p(onProgress))),
  readExif: (file: Blob) => run((r) => r.readExif(file)),
  inspect: (file: Blob, opts: Parameters<IoApi['inspect']>[1]) => run((r) => r.inspect(file, opts)),
  heicThumbnail: (file: Blob, size: number) => run((r) => r.heicThumbnail(file, size)),
  copyEncrypted: (file: Blob, h: FileSystemFileHandle, keys: DiskKeys, onProgress: ProgressFn) => run((r) => r.copyEncrypted(file, h, keys, p(onProgress))),
  hashEncrypted: (h: FileSystemFileHandle, keys: DiskKeys, onProgress: ProgressFn) => run((r) => r.hashEncrypted(h, keys, p(onProgress))),
  decryptTo: (src: FileSystemFileHandle, dest: FileSystemFileHandle, keys: DiskKeys, onProgress: ProgressFn) => run((r) => r.decryptTo(src, dest, keys, p(onProgress))),
  createEncryption: (password: string) => run((r) => r.createEncryption(password)),
  unlock: (password: string, params: EncryptionParams) => run((r) => r.unlock(password, params)),
}

/** La pausa/cancelación del motor se reenvía a los Workers (ver state/app). */
export const workerHasher: Hasher = {
  hash: (file, onProgress) => io.hashBlob(file, onProgress),
}

export const workerExif: ExifReader = (file) => io.readExif(file)
