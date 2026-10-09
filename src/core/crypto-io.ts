import { createSHA256 } from 'hash-wasm'
import { decryptStream, encryptStream, type DiskKeys, type Sink } from './crypto'
import type { ProgressFn, RunControl } from './types'

// Operaciones de archivo para discos cifrados. El hash siempre es el del
// contenido ORIGINAL (sin cifrar): así la deduplicación y la verificación
// funcionan igual que en un disco normal.

/** Cifra `source` hacia `sink` y devuelve el SHA-256 del contenido original. */
export async function encryptCopy(keys: DiskKeys, source: Blob, sink: Sink, onProgress: ProgressFn, control: RunControl) {
  const hasher = await createSHA256()
  hasher.init()
  await encryptStream(keys, source.stream(), sink, async (b) => {
    await control.checkpoint()
    hasher.update(b)
    onProgress(b.byteLength)
  })
  return hasher.digest('hex')
}

/** Descifra (opcionalmente hacia `sink`) y devuelve el SHA-256 del contenido original. */
export async function decryptCopy(keys: DiskKeys, cipher: Blob, sink: Sink | null, onProgress: ProgressFn, control: RunControl) {
  const hasher = await createSHA256()
  hasher.init()
  await decryptStream(keys, cipher.stream(), {
    write: async (b) => {
      await control.checkpoint()
      hasher.update(b)
      if (sink) await sink.write(b)
      onProgress(b.byteLength)
    },
  })
  return hasher.digest('hex')
}
