// Cifrado opcional por disco.
//
// Clave: Argon2id (hash-wasm) a partir de la contraseña → clave AES-GCM de
// 256 bits no exportable (Web Crypto).
//
// Formato de archivo "BFENC1" (pensado para vídeos grandes en streaming):
//   cabecera (32 bytes): "BFENC1\0\0" | tamaño de bloque (u32 BE) | prefijo de nonce (8 bytes aleatorios) | 12 bytes reservados
//   bloques: AES-GCM(clave, nonce = prefijo ‖ nº de bloque (u32 BE), bloque de hasta 1 MiB)
//            con datos adicionales autenticados = cabecera ‖ nº de bloque ‖ ¿último? (1 byte)
// Cada bloque cifrado ocupa el bloque + 16 bytes de etiqueta. Marcar el
// último bloque impide truncar el archivo por un límite de bloque sin que se
// note; el número de bloque impide reordenarlos.

import { argon2id } from 'hash-wasm'

export interface EncryptionParams {
  version: 1
  kdf: 'argon2id'
  salt: string
  memoryKiB: number
  iterations: number
  parallelism: number
  /** Texto conocido cifrado con la clave, para comprobar la contraseña. */
  check: string
}

export interface DiskKeys {
  /** Clave AES-GCM de 256 bits derivada de la contraseña. */
  key: CryptoKey
}

export class WrongPasswordError extends Error {
  name = 'WrongPasswordError'
  constructor() {
    super('Contraseña incorrecta')
  }
}

export class DecryptError extends Error {
  name = 'DecryptError'
  constructor(msg = 'El archivo cifrado está dañado o no corresponde a esta clave') {
    super(msg)
  }
}

const MAGIC = new TextEncoder().encode('BFENC1\0\0')
export const HEADER_SIZE = 32
export const CHUNK_SIZE = 1024 * 1024
const TAG = 16
const CHECK_TEXT = 'backup-fotos:clave-correcta'

export const DEFAULT_KDF = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 }

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export async function deriveKey(password: string, p: Pick<EncryptionParams, 'salt' | 'memoryKiB' | 'iterations' | 'parallelism'>): Promise<DiskKeys> {
  const raw = await argon2id({
    password: password.normalize('NFC'),
    salt: unb64(p.salt),
    memorySize: p.memoryKiB,
    iterations: p.iterations,
    parallelism: p.parallelism,
    hashLength: 32,
    outputType: 'binary',
  })
  const key = await crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt'])
  raw.fill(0)
  return { key }
}

/** Prepara el cifrado de un disco nuevo: parámetros (para .backup-disk-id) y clave. */
export async function createEncryption(password: string, kdf = DEFAULT_KDF): Promise<{ params: EncryptionParams; keys: DiskKeys }> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)))
  const keys = await deriveKey(password, { salt, ...kdf })
  const check = b64(await encryptBytes(keys, new TextEncoder().encode(CHECK_TEXT)))
  return { params: { version: 1, kdf: 'argon2id', salt, ...kdf, check }, keys }
}

/** Deriva la clave y comprueba que la contraseña es la correcta. */
export async function unlock(password: string, params: EncryptionParams): Promise<DiskKeys> {
  const keys = await deriveKey(password, params)
  try {
    const text = new TextDecoder().decode(await decryptBytes(keys, unb64(params.check)))
    if (text !== CHECK_TEXT) throw new WrongPasswordError()
  } catch {
    throw new WrongPasswordError()
  }
  return keys
}

function header(chunkSize: number) {
  const h = new Uint8Array(HEADER_SIZE)
  h.set(MAGIC, 0)
  new DataView(h.buffer).setUint32(8, chunkSize)
  h.set(crypto.getRandomValues(new Uint8Array(8)), 12)
  return h
}

function parseHeader(h: Uint8Array) {
  if (h.byteLength < HEADER_SIZE || !MAGIC.every((v, i) => h[i] === v)) throw new DecryptError('No es un archivo cifrado por esta app')
  const chunkSize = new DataView(h.buffer, h.byteOffset).getUint32(8)
  if (chunkSize < 1 || chunkSize > 64 * 1024 * 1024) throw new DecryptError()
  return chunkSize
}

function nonce(h: Uint8Array, index: number) {
  const n = new Uint8Array(12)
  n.set(h.subarray(12, 20), 0)
  new DataView(n.buffer).setUint32(8, index)
  return n
}

function aad(h: Uint8Array, index: number, last: boolean) {
  const a = new Uint8Array(HEADER_SIZE + 5)
  a.set(h.subarray(0, HEADER_SIZE), 0)
  new DataView(a.buffer).setUint32(HEADER_SIZE, index)
  a[HEADER_SIZE + 4] = last ? 1 : 0
  return a
}

async function sealChunk(keys: DiskKeys, h: Uint8Array, index: number, last: boolean, plain: Uint8Array) {
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(h, index), additionalData: aad(h, index, last) }, keys.key, plain as Uint8Array<ArrayBuffer>)
  return new Uint8Array(ct)
}

async function openChunk(keys: DiskKeys, h: Uint8Array, index: number, last: boolean, ct: Uint8Array) {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce(h, index), additionalData: aad(h, index, last) }, keys.key, ct as Uint8Array<ArrayBuffer>)
    return new Uint8Array(pt)
  } catch {
    throw new DecryptError()
  }
}

/** Tamaño del contenido original a partir del tamaño del archivo cifrado. */
export function plainSize(cipherSize: number, chunkSize = CHUNK_SIZE) {
  const body = cipherSize - HEADER_SIZE
  if (body < TAG) return 0
  const chunks = Math.ceil(body / (chunkSize + TAG))
  return body - chunks * TAG
}

export interface Sink {
  write(chunk: Uint8Array<ArrayBuffer>): Promise<void> | void
}

/**
 * Cifra un flujo en streaming. `onPlain` recibe cada trozo original (para
 * calcular el hash del contenido sin cifrar).
 */
export async function encryptStream(keys: DiskKeys, source: ReadableStream<Uint8Array<ArrayBuffer>>, sink: Sink, onPlain?: (b: Uint8Array<ArrayBuffer>) => void | Promise<void>, chunkSize = CHUNK_SIZE) {
  const h = header(chunkSize)
  await sink.write(h)
  const reader = source.getReader()
  let buf = new Uint8Array(chunkSize)
  let fill = 0
  let index = 0
  let pending: Uint8Array<ArrayBuffer> | null = null // se retiene un bloque para saber si es el último
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await onPlain?.(value)
      let off = 0
      while (off < value.byteLength) {
        const n = Math.min(chunkSize - fill, value.byteLength - off)
        buf.set(value.subarray(off, off + n), fill)
        fill += n
        off += n
        if (fill === chunkSize) {
          if (pending) await sink.write(await sealChunk(keys, h, index++, false, pending))
          pending = buf
          buf = new Uint8Array(chunkSize)
          fill = 0
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (fill > 0 || !pending) {
    if (pending) await sink.write(await sealChunk(keys, h, index++, false, pending))
    await sink.write(await sealChunk(keys, h, index, true, buf.subarray(0, fill)))
  } else {
    await sink.write(await sealChunk(keys, h, index, true, pending))
  }
}

/** Descifra un flujo en streaming; lanza DecryptError si algo no cuadra (dañado, truncado, otra clave). */
export async function decryptStream(keys: DiskKeys, source: ReadableStream<Uint8Array<ArrayBuffer>>, sink: Sink) {
  const reader = source.getReader()
  const q = new ByteQueue()
  let h: Uint8Array | null = null
  let chunkSize = 0
  let index = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      q.push(value)
      if (!h && q.length >= HEADER_SIZE) {
        h = q.take(HEADER_SIZE)
        chunkSize = parseHeader(h)
      }
      // Solo se procesa un bloque cuando hay más datos detrás (así se sabe que no es el último).
      while (h && q.length > chunkSize + TAG) {
        await sink.write(await openChunk(keys, h, index++, false, q.take(chunkSize + TAG)))
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (!h || q.length < TAG) throw new DecryptError('Archivo cifrado incompleto')
  await sink.write(await openChunk(keys, h, index, true, q.take(q.length)))
}

/** Cola de bytes sin copias innecesarias: solo se concatena lo que se extrae. */
class ByteQueue {
  private parts: Uint8Array<ArrayBuffer>[] = []
  length = 0

  push(b: Uint8Array<ArrayBuffer>) {
    if (b.byteLength) {
      this.parts.push(b)
      this.length += b.byteLength
    }
  }

  take(n: number) {
    const out = new Uint8Array(n)
    let o = 0
    while (o < n) {
      const p = this.parts[0]
      const k = Math.min(p.byteLength, n - o)
      out.set(p.subarray(0, k), o)
      o += k
      if (k === p.byteLength) this.parts.shift()
      else this.parts[0] = p.subarray(k)
    }
    this.length -= n
    return out
  }
}

function streamOf(bytes: Uint8Array) {
  return new Blob([bytes as Uint8Array<ArrayBuffer>]).stream()
}

export async function encryptBytes(keys: DiskKeys, plain: Uint8Array) {
  const parts: Uint8Array<ArrayBuffer>[] = []
  await encryptStream(keys, streamOf(plain), { write: (c) => void parts.push(c) })
  return concat(parts)
}

export async function decryptBytes(keys: DiskKeys, cipher: Uint8Array) {
  const parts: Uint8Array<ArrayBuffer>[] = []
  await decryptStream(keys, streamOf(cipher), { write: (c) => void parts.push(c) })
  return concat(parts)
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.byteLength, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.byteLength
  }
  return out
}
