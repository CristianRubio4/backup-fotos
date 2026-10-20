// Copia por internet: el móvil (fuera de casa) envía sus fotos al PC de casa.
// Conexión directa entre los dos navegadores (WebRTC, cifrada de extremo a extremo).
// Para encontrarse usan el servidor público de PeerJS, que solo les pasa la
// dirección del otro: las fotos no pasan por él. Solo entra un móvil emparejado:
// el PC le pide una prueba con la clave secreta que compartieron con el QR.

import type { DataConnection, Peer } from 'peerjs'

/** Servidores STUN públicos: cada aparato averigua su dirección en internet. */
export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }]

const PEER_PREFIX = 'bfotos-'
/** Trozo de archivo por mensaje. */
const CHUNK = 256 * 1024
/** Si el canal tiene más pendiente de enviar, se espera (no se llena la memoria). */
const HIGH_WATER = 8 * 1024 * 1024
/** Sin recibir nada de un archivo en este tiempo, se da por perdido (la conexión se cortó). */
const FILE_TIMEOUT_MS = 90_000

export interface Pairing {
  /** Dirección del PC en el servidor de encuentro. */
  pcId: string
  /** Clave compartida con el QR: solo quien la tiene puede enviar. */
  secret: string
  pcName: string
}

export interface RemoteFile {
  path: string
  name: string
  size: number
  mtime: number
}

/** Un destino del PC (disco o carpeta de "Dónde guardar"), para elegirlo desde el móvil. */
export interface PcDisk {
  key: string
  name: string
  /** Conectado y con acceso: se puede copiar ahí ahora. */
  ready: boolean
}

export interface RemoteProgress {
  pct: number
  done: number
  total: number
  copied: number
  speed: number
  eta: number | null
  phase: string
}

export type Msg =
  | { t: 'challenge'; nonce: string }
  | { t: 'hello'; proof: string; device: string }
  | { t: 'ready'; pc: string; disks: PcDisk[]; active: string | null }
  | { t: 'denied'; reason: string }
  | { t: 'start'; device: string; files: RemoteFile[]; dirs: string[]; diskKey?: string }
  | { t: 'get'; id: number; path: string }
  | { t: 'chunk'; id: number; data: ArrayBuffer }
  | { t: 'eof'; id: number }
  | { t: 'err'; id: number; reason: string }
  | ({ t: 'progress' } & RemoteProgress)
  | { t: 'done'; outcome: string; copied: number; errors: number; folder: string | null; failure?: string }
  | { t: 'cancel' }

// ---- Claves y emparejamiento ----

function b64url(bytes: Uint8Array) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromB64url(s: string) {
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export function randomToken(bytes = 24) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export function newPairing(pcName: string): Pairing {
  return { pcId: PEER_PREFIX + randomToken(15).replaceAll('_', 'x').replaceAll('-', 'y'), secret: randomToken(32), pcName }
}

/** Prueba de que se conoce la clave, sin enviarla: HMAC-SHA256(clave, reto). */
export async function proofFor(secret: string, nonce: string) {
  const key = await crypto.subtle.importKey('raw', fromB64url(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(nonce))))
}

/** Comparación sin atajos (no revela por tiempos cuántos caracteres coinciden). */
export function sameText(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const HASH_KEY = 'emparejar'

/** Enlace (y QR) para emparejar el móvil: al abrirlo, la app del móvil guarda el PC. */
export function pairingLink(p: Pairing, base = `${location.origin}${import.meta.env.BASE_URL}`) {
  return `${base}#${HASH_KEY}=${b64url(new TextEncoder().encode(JSON.stringify(p)))}`
}

export function parsePairing(hash: string): Pairing | null {
  const m = new RegExp(`${HASH_KEY}=([A-Za-z0-9_-]+)`).exec(hash)
  if (!m) return null
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(m[1]))) as Pairing
    return typeof p.pcId === 'string' && p.pcId.startsWith(PEER_PREFIX) && typeof p.secret === 'string' && typeof p.pcName === 'string' ? p : null
  } catch {
    return null
  }
}

// ---- Conexión ----

/** PeerJS (~100 KB) se carga solo al usar esta función. */
export async function openPeer(id?: string): Promise<Peer> {
  const { Peer } = await import('peerjs')
  const peer = id ? new Peer(id, { config: { iceServers: ICE_SERVERS }, debug: 0 }) : new Peer({ config: { iceServers: ICE_SERVERS }, debug: 0 })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No se puede conectar con el servidor de encuentro. Comprueba la conexión a internet.')), 20_000)
    peer.once('open', () => {
      clearTimeout(timer)
      resolve()
    })
    peer.once('error', (err) => {
      clearTimeout(timer)
      reject(peerError(err))
    })
  })
  return peer
}

export function peerError(err: unknown): Error {
  const type = (err as { type?: string })?.type
  if (type === 'unavailable-id') return new Error('Este PC ya está recibiendo en otra pestaña o ventana. Ciérrala o usa esa.')
  if (type === 'peer-unavailable') return new Error('El PC de casa no está esperando: abre en él la web, en "Móvil ↔ PC", y pulsa "Recibir del móvil".')
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return new Error('Sin conexión con el servidor de encuentro. Comprueba la conexión a internet.')
  if (type === 'webrtc' || type === 'negotiation-failed') return new Error('No se ha podido establecer la conexión directa entre el móvil y el PC (algunas redes móviles lo impiden). Prueba con otra wifi.')
  return err instanceof Error ? err : new Error(String(err))
}

export type Channel = Pick<DataConnection, 'send' | 'close'> & { dataChannel?: RTCDataChannel }

// ---- Transferencia de archivos (independiente de la red: se prueba con un canal en memoria) ----

/** En el PC: pide archivos al móvil y los recibe por trozos. */
export class FileClient {
  private nextId = 1
  private pending = new Map<number, { parts: ArrayBuffer[]; resolve: (b: Blob) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  constructor(
    private send: (m: Msg) => void,
    private timeoutMs = FILE_TIMEOUT_MS,
  ) {}

  get(path: string): Promise<Blob> {
    const id = this.nextId++
    return new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(id, 'El móvil ha dejado de enviar (conexión cortada o pantalla apagada).'), this.timeoutMs)
      this.pending.set(id, { parts: [], resolve, reject, timer })
      try {
        this.send({ t: 'get', id, path })
      } catch (err) {
        this.fail(id, `No se ha podido pedir al móvil: ${(err as Error).message}`)
      }
    })
  }

  /** Procesa un mensaje del móvil; devuelve true si era de un archivo. */
  handle(m: Msg): boolean {
    if (m.t !== 'chunk' && m.t !== 'eof' && m.t !== 'err') return false
    const p = this.pending.get(m.id)
    if (!p) return true
    clearTimeout(p.timer)
    if (m.t === 'chunk') {
      p.parts.push(m.data)
      p.timer = setTimeout(() => this.fail(m.id, 'El móvil ha dejado de enviar (conexión cortada o pantalla apagada).'), this.timeoutMs)
    } else if (m.t === 'eof') {
      this.pending.delete(m.id)
      p.resolve(new Blob(p.parts))
    } else this.fail(m.id, m.reason)
    return true
  }

  private fail(id: number, reason: string) {
    const p = this.pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(id)
    p.reject(new DOMException(reason, 'NotReadableError'))
  }

  /** La conexión se ha cerrado: todo lo pendiente falla. */
  failAll(reason: string) {
    for (const id of [...this.pending.keys()]) this.fail(id, reason)
  }
}

/** En el móvil: envía un archivo por trozos, sin llenar la memoria si la red va lenta. */
export async function serveFile(ch: Channel, id: number, file: { getFile(): Promise<Blob> } | undefined) {
  if (!file) {
    ch.send({ t: 'err', id, reason: 'Ese archivo ya no está en el móvil' } satisfies Msg)
    return
  }
  try {
    const blob = await file.getFile()
    for (let off = 0; off < blob.size; off += CHUNK) {
      while ((ch.dataChannel?.bufferedAmount ?? 0) > HIGH_WATER) await new Promise((r) => setTimeout(r, 25))
      ch.send({ t: 'chunk', id, data: await blob.slice(off, off + CHUNK).arrayBuffer() } satisfies Msg)
    }
    ch.send({ t: 'eof', id } satisfies Msg)
  } catch (err) {
    ch.send({ t: 'err', id, reason: `No se ha podido leer en el móvil: ${(err as Error).message}` } satisfies Msg)
  }
}
