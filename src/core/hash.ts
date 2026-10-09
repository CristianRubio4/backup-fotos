import { createSHA256 } from 'hash-wasm'
import type { ProgressFn, RunControl } from './types'

// crypto.subtle.digest no es incremental (necesita el archivo entero en
// memoria), así que usamos hash-wasm, que procesa el archivo por bloques.

export interface StreamSink {
  write(chunk: Uint8Array<ArrayBuffer>): Promise<void> | void
}

/**
 * Lee `stream` por bloques, calcula su SHA-256 y, si se indica, reenvía cada
 * bloque a `sink`. Respeta pausa/cancelación entre bloques.
 */
export async function hashStream(
  stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  onProgress: ProgressFn,
  control: RunControl,
  sink?: StreamSink,
): Promise<string> {
  const hasher = await createSHA256()
  hasher.init()
  const reader = stream.getReader()
  try {
    for (;;) {
      await control.checkpoint()
      const { done, value } = await reader.read()
      if (done) break
      hasher.update(value)
      if (sink) await sink.write(value)
      onProgress(value.byteLength)
    }
  } catch (err) {
    await reader.cancel().catch(() => {})
    throw err
  } finally {
    reader.releaseLock()
  }
  return hasher.digest('hex')
}

export function hashBlob(blob: Blob, onProgress: ProgressFn, control: RunControl) {
  return hashStream(blob.stream(), onProgress, control)
}
