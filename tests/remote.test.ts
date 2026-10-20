import { describe, expect, it } from 'vitest'
import { FileClient, newPairing, pairingLink, parsePairing, proofFor, sameText, serveFile, type Channel, type Msg } from '../src/platform/remote'

/** Canal en memoria entre PC y móvil, con entrega asíncrona como la red. */
function channelPair() {
  let toPc: (m: Msg) => void = () => {}
  let toPhone: (m: Msg) => void = () => {}
  const phone: Channel = { send: (m: Msg) => void queueMicrotask(() => toPc(m)), close: () => {} } as Channel
  const pc = { send: (m: Msg) => void queueMicrotask(() => toPhone(m)) }
  return {
    phone,
    pc,
    onPc: (f: (m: Msg) => void) => (toPc = f),
    onPhone: (f: (m: Msg) => void) => (toPhone = f),
  }
}

describe('copia móvil ↔ PC por internet', () => {
  it('el enlace / QR de emparejamiento lleva el PC y su clave, y se lee de vuelta', () => {
    const p = newPairing('PC de casa')
    expect(p.pcId).toMatch(/^bfotos-[A-Za-z0-9]+$/)
    const link = pairingLink(p, 'https://cristianrubio4.github.io/backup-fotos/')
    expect(link.startsWith('https://cristianrubio4.github.io/backup-fotos/#emparejar=')).toBe(true)
    expect(parsePairing(new URL(link).hash)).toEqual(p)
    expect(parsePairing('#emparejar=basura')).toBeNull()
    expect(parsePairing('')).toBeNull()
  })

  it('solo entra quien tiene la clave (prueba HMAC, sin enviar la clave)', async () => {
    const p = newPairing('PC')
    const otra = newPairing('Otro')
    const nonce = 'reto-123'
    const buena = await proofFor(p.secret, nonce)
    expect(sameText(buena, await proofFor(p.secret, nonce))).toBe(true)
    expect(sameText(buena, await proofFor(otra.secret, nonce))).toBe(false)
    expect(sameText(buena, await proofFor(p.secret, 'otro-reto'))).toBe(false)
    expect(buena).not.toContain(p.secret)
  })

  it('los archivos llegan completos e idénticos, por trozos y varios a la vez', async () => {
    const ch = channelPair()
    const big = new Uint8Array(1024 * 1024 + 777).map((_, i) => (i * 31) % 251) // más de 4 trozos
    const files = new Map<string, { getFile(): Promise<Blob> }>([
      ['DCIM/IMG_1.jpg', { getFile: async () => new Blob(['foto pequeña']) }],
      ['DCIM/VID_1.mp4', { getFile: async () => new Blob([big]) }],
      ['vacio.jpg', { getFile: async () => new Blob([]) }],
    ])
    // Móvil: sirve lo que le piden.
    ch.onPhone((m) => {
      if (m.t === 'get') void serveFile(ch.phone, m.id, files.get(m.path))
    })
    // PC: pide y recibe.
    const client = new FileClient((m) => ch.pc.send(m))
    ch.onPc((m) => client.handle(m))
    const [a, b, c] = await Promise.all([client.get('DCIM/IMG_1.jpg'), client.get('DCIM/VID_1.mp4'), client.get('vacio.jpg')])
    expect(await a.text()).toBe('foto pequeña')
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(big)
    expect(c.size).toBe(0)
  })

  it('un archivo que ya no está en el móvil da un error claro (y el resto sigue)', async () => {
    const ch = channelPair()
    ch.onPhone((m) => {
      if (m.t === 'get') void serveFile(ch.phone, m.id, m.path === 'ok.jpg' ? { getFile: async () => new Blob(['ok']) } : undefined)
    })
    const client = new FileClient((m) => ch.pc.send(m))
    ch.onPc((m) => client.handle(m))
    await expect(client.get('borrada.jpg')).rejects.toThrow(/ya no está en el móvil/)
    expect(await (await client.get('ok.jpg')).text()).toBe('ok')
  })

  it('si el móvil deja de enviar o se corta la conexión, lo pendiente falla (no se queda colgado)', async () => {
    const silent = new FileClient(() => {}, 50)
    await expect(silent.get('a.jpg')).rejects.toThrow(/dejado de enviar/)
    const cut = new FileClient(() => {}, 60_000)
    const pending = cut.get('b.jpg')
    cut.failAll('Se ha cortado la conexión con el móvil.')
    await expect(pending).rejects.toThrow(/cortado/)
  })
})
