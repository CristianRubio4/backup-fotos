import type { DataConnection, Peer } from 'peerjs'
import { create } from 'zustand'
import { noControl } from '../core/control'
import type { SourceFile } from '../core/types'
import { db } from '../db'
import { ensurePermission } from '../platform/capabilities'
import { keepScreenOn } from '../platform/power'
import {
  FileClient,
  newPairing,
  openPeer,
  pairingLink,
  parsePairing,
  peerError,
  proofFor,
  randomToken,
  sameText,
  serveFile,
  type Msg,
  type Pairing,
  type RemoteProgress,
} from '../platform/remote'
import { walkSource } from '../platform/walk'
import { activeDisk, startRemote, useApp } from './app'

type ReceiverState = 'off' | 'starting' | 'on' | 'error'
type SenderState = 'idle' | 'connecting' | 'scanning' | 'sending' | 'done' | 'error'

interface RemoteStore {
  // ---- PC de casa (recibe) ----
  pairing: Pairing | null
  receiver: ReceiverState
  receiverError: string | null
  /** Móvil conectado ahora mismo. */
  phone: string | null
  link: string | null
  startReceiver(): Promise<void>
  stopReceiver(): void
  /** Nueva clave: el móvil emparejado antes deja de poder enviar. */
  resetPairing(): Promise<void>

  // ---- Móvil (envía) ----
  target: Pairing | null
  sender: SenderState
  senderInfo: string | null
  progress: RemoteProgress | null
  result: Extract<Msg, { t: 'done' }> | null
  loadTarget(): Promise<void>
  forgetTarget(): Promise<void>
  send(): Promise<void>
  cancelSend(): void
}

let peer: Peer | null = null
let senderConn: DataConnection | null = null

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const useRemote = create<RemoteStore>((set, get) => ({
  pairing: null,
  receiver: 'off',
  receiverError: null,
  phone: null,
  link: null,
  target: null,
  sender: 'idle',
  senderInfo: null,
  progress: null,
  result: null,

  // ================= PC de casa =================

  async startReceiver() {
    if (get().receiver === 'on' || get().receiver === 'starting') return
    const disk = activeDisk()
    if (!disk) return set({ receiver: 'error', receiverError: 'Primero elige dónde guardar (Inicio → Dónde guardar) y conecta el disco.' })
    // El permiso del disco se pide ahora (con el clic): cuando llegue el móvil no habrá nadie delante del PC.
    if ((await ensurePermission(disk.handle, 'readwrite', true)) !== 'granted') return set({ receiver: 'error', receiverError: 'Sin permiso de acceso al disco no se puede recibir.' })
    set({ receiver: 'starting', receiverError: null })
    let pairing = await db.getRemotePairing()
    if (!pairing) {
      pairing = newPairing(useApp.getState().device.name || 'PC de casa')
      await db.setRemotePairing(pairing)
    }
    try {
      peer = await openPeer(pairing.pcId)
    } catch (err) {
      return set({ receiver: 'error', receiverError: peerError(err).message })
    }
    // El PC no se suspende mientras espera (Wake Lock; además conviene desactivar la suspensión en Windows).
    keepScreenOn(true)
    peer.on('connection', (conn) => acceptPhone(conn, pairing))
    peer.on('disconnected', () => {
      // Se perdió el servidor de encuentro (p. ej. un corte de internet): se reintenta solo.
      setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 3000)
    })
    peer.on('error', (err) => {
      const type = (err as { type?: string }).type
      if (type === 'network' || type === 'server-error' || type === 'socket-error') return // se reintenta al desconectarse
      set({ receiverError: peerError(err).message })
    })
    set({ receiver: 'on', pairing, link: pairingLink(pairing) })
  },

  stopReceiver() {
    peer?.destroy()
    peer = null
    keepScreenOn(false)
    set({ receiver: 'off', phone: null })
  },

  async resetPairing() {
    get().stopReceiver()
    const pairing = newPairing(useApp.getState().device.name || 'PC de casa')
    await db.setRemotePairing(pairing)
    set({ pairing, link: null })
  },

  // ================= Móvil =================

  async loadTarget() {
    // Abierta desde el enlace o el QR del PC: se guarda el PC y se limpia la dirección.
    const fromLink = parsePairing(location.hash)
    if (fromLink) {
      await db.setRemoteTarget(fromLink)
      history.replaceState(null, '', location.pathname + location.search)
      set({ target: fromLink })
      useApp.getState().setNotice(`Este móvil queda emparejado con "${fromLink.pcName}". Ya puedes copiar tus fotos en él desde cualquier sitio (Móvil ↔ PC).`)
      useApp.getState().go('remote')
      return
    }
    set({ target: await db.getRemoteTarget() })
  },

  async forgetTarget() {
    await db.setRemoteTarget(null)
    set({ target: null })
  },

  async send() {
    const target = get().target
    const app = useApp.getState()
    if (!target || get().sender === 'connecting' || get().sender === 'scanning' || get().sender === 'sending') return
    if (app.sources.length === 0) return set({ sender: 'error', senderInfo: 'Añade primero las carpetas del móvil (Inicio → Fotos que copiar → Añadir): DCIM, Pictures, WhatsApp…' })
    // Permisos de las carpetas: con el clic.
    const sources = []
    for (const s of app.sources) if ((await ensurePermission(s.handle, 'read', true).catch(() => 'denied' as const)) === 'granted') sources.push(s)
    if (!sources.length) return set({ sender: 'error', senderInfo: 'Sin permiso para leer las carpetas de fotos.' })

    set({ sender: 'connecting', senderInfo: `Conectando con "${target.pcName}"…`, progress: null, result: null })
    keepScreenOn(true)
    let p: Peer
    try {
      p = await openPeer()
    } catch (err) {
      keepScreenOn(false)
      return set({ sender: 'error', senderInfo: peerError(err).message })
    }
    const conn = p.connect(target.pcId, { reliable: true, serialization: 'binary' })
    senderConn = conn
    const finish = (state: SenderState, info: string | null) => {
      keepScreenOn(false)
      set({ sender: state, senderInfo: info })
      setTimeout(() => p.destroy(), 1000)
      senderConn = null
    }
    const opened = await Promise.race([
      new Promise<boolean>((r) => conn.once('open', () => r(true))),
      new Promise<boolean>((r) => p.once('error', () => r(false))),
      wait(25_000).then(() => false),
    ])
    if (!opened) return finish('error', `"${target.pcName}" no responde. Comprueba que en el PC está abierta la web en "Móvil ↔ PC" con "Recibir del móvil" activado, y que tiene internet.`)

    const files = new Map<string, SourceFile>()
    conn.on('data', async (raw) => {
      const m = raw as Msg
      switch (m.t) {
        case 'challenge':
          conn.send({ t: 'hello', proof: await proofFor(target.secret, m.nonce), device: app.device.name || 'Móvil' } satisfies Msg)
          break
        case 'denied':
          finish('error', m.reason)
          break
        case 'ready': {
          set({ sender: 'scanning', senderInfo: 'Buscando fotos en el móvil…' })
          const list: SourceFile[] = []
          const dirs: string[] = []
          for (const s of sources) {
            try {
              const r = await walkSource(s.handle, null, noControl, (n) => set({ senderInfo: `Buscando fotos en el móvil… ${n}` }), {
                label: s.name,
                skipSent: !app.settings.whatsappSent,
              })
              list.push(...r.files)
              dirs.push(...(r.dirs ?? []))
            } catch {
              // Carpeta ilegible: se sigue con las demás.
            }
          }
          for (const f of list) files.set(f.relPath, f)
          set({ sender: 'sending', senderInfo: `Enviando ${list.length} fotos y vídeos a "${target.pcName}"…` })
          conn.send({ t: 'start', device: app.device.name || 'Móvil', files: list.map((f) => ({ path: f.relPath, name: f.name, size: f.size, mtime: f.lastModified })), dirs } satisfies Msg)
          break
        }
        case 'get':
          void serveFile(conn, m.id, files.get(m.path))
          break
        case 'progress':
          set({ progress: m })
          break
        case 'done':
          set({ result: m })
          finish(m.outcome === 'completed' ? 'done' : 'error', m.outcome === 'completed' ? `Copia terminada en "${target.pcName}".` : (m.failure ?? 'La copia no se ha completado. Vuelve a pulsar "Copiar": continuará donde se quedó.'))
          break
      }
    })
    conn.on('close', () => {
      if (get().sender === 'sending' || get().sender === 'scanning' || get().sender === 'connecting')
        finish('error', 'Se ha cortado la conexión con el PC. Vuelve a pulsar "Copiar": continuará donde se quedó, sin repetir nada.')
    })
  },

  cancelSend() {
    try {
      senderConn?.send({ t: 'cancel' } satisfies Msg)
    } catch {
      // Ya cerrada.
    }
  },
}))

/** El PC recibe a un móvil: lo autentica y, si todo va bien, hace la copia con lo que le envía. */
function acceptPhone(conn: DataConnection, pairing: Pairing) {
  const nonce = randomToken(24)
  let authed = false
  let device = 'Móvil'
  const client = new FileClient((m) => conn.send(m))
  let unsubscribe: (() => void) | null = null

  conn.on('open', () => conn.send({ t: 'challenge', nonce } satisfies Msg))
  conn.on('data', async (raw) => {
    const m = raw as Msg
    if (!authed) {
      if (m.t !== 'hello' || !sameText(m.proof, await proofFor(pairing.secret, nonce))) {
        conn.send({ t: 'denied', reason: 'Este móvil no está emparejado con este PC. Vuelve a escanear el código QR del PC.' } satisfies Msg)
        setTimeout(() => conn.close(), 500)
        return
      }
      authed = true
      device = m.device
      if (useApp.getState().running) {
        conn.send({ t: 'denied', reason: 'El PC está haciendo otra copia ahora mismo. Inténtalo cuando termine.' } satisfies Msg)
        setTimeout(() => conn.close(), 500)
        return
      }
      useRemote.setState({ phone: device })
      conn.send({ t: 'ready', pc: pairing.pcName } satisfies Msg)
      return
    }
    if (client.handle(m)) return
    if (m.t === 'cancel') useApp.getState().cancel()
    else if (m.t === 'start') {
      const files: SourceFile[] = m.files.map((f) => ({
        relPath: f.path,
        name: f.name,
        size: f.size,
        lastModified: f.mtime,
        getFile: () => client.get(f.path),
        // Caché de huellas: mismo móvil, misma ruta, tamaño y fecha → al continuar una copia no se vuelve a pedir.
        cacheKey: `remoto:${device}:${f.path}`,
      }))
      // Progreso al móvil, como mucho una vez por segundo.
      let last = 0
      unsubscribe = useApp.subscribe((s) => {
        const p = s.progress
        if (!p || Date.now() - last < 1000) return
        last = Date.now()
        try {
          conn.send({
            t: 'progress',
            pct: p.totalBytes > 0 ? Math.floor((p.doneBytes / p.totalBytes) * 100) : 0,
            done: p.phaseDone,
            total: p.phaseTotal,
            copied: p.counters.copied,
            speed: p.bytesPerSec,
            eta: p.etaSec,
            phase: p.phase,
          } satisfies Msg)
        } catch {
          // Conexión cerrada: se gestiona en 'close'.
        }
      })
      try {
        const report = await startRemote({ name: device, files, dirs: m.dirs })
        conn.send({
          t: 'done',
          outcome: report?.outcome ?? 'failed',
          copied: report ? report.copied.length + report.alreadyOnDisk.length : 0,
          errors: report ? report.errors.length : 0,
          folder: report?.folder ?? null,
          failure: report?.failure,
        } satisfies Msg)
      } catch (err) {
        conn.send({ t: 'done', outcome: 'failed', copied: 0, errors: 0, folder: null, failure: (err as Error).message } satisfies Msg)
      } finally {
        unsubscribe?.()
        setTimeout(() => conn.close(), 1500)
      }
    }
  })
  conn.on('close', () => {
    unsubscribe?.()
    client.failAll('Se ha cortado la conexión con el móvil.')
    // Si se corta a mitad, la copia se para y queda para "Continuar" (lo copiado está guardado).
    if (useApp.getState().running && useRemote.getState().phone === device) useApp.getState().cancel()
    useRemote.setState({ phone: null })
  })
}
