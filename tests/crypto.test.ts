import { describe, expect, it } from 'vitest'
import { runBackup } from '../src/core/backup/engine'
import { Controller, noControl } from '../src/core/control'
import {
  CHUNK_SIZE,
  createEncryption,
  decryptBytes,
  decryptStream,
  encryptBytes,
  encryptStream,
  plainSize,
  unlock,
  WrongPasswordError,
  type DiskKeys,
} from '../src/core/crypto'
import { MANIFEST_FILE } from '../src/core/manifest/schema'
import { ManifestStore } from '../src/core/manifest/store'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import { checkIntegrity } from '../src/core/tools/integrity'
import { EncryptedMemoryTarget, src, testHasher } from './fakes'

// Parámetros de Argon2id rebajados para que los tests sean rápidos (la app usa 64 MiB y 3 iteraciones).
const FAST = { memoryKiB: 1024, iterations: 1, parallelism: 1 }

async function keys(): Promise<DiskKeys> {
  return (await createEncryption('contraseña de prueba', FAST)).keys
}

const rnd = (n: number) => {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)))
  return b
}

describe('contraseña', () => {
  it('desbloquea con la contraseña correcta y rechaza la incorrecta', async () => {
    const { params, keys: k1 } = await createEncryption('mi clave secreta', FAST)
    const k2 = await unlock('mi clave secreta', params)
    const data = new TextEncoder().encode('hola')
    expect(new TextDecoder().decode(await decryptBytes(k2, await encryptBytes(k1, data)))).toBe('hola')
    await expect(unlock('otra clave', params)).rejects.toBeInstanceOf(WrongPasswordError)
    expect(JSON.stringify(params)).not.toContain('mi clave secreta')
  })
})

describe('formato por bloques', () => {
  it.each([0, 1, 1000, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, 3 * CHUNK_SIZE + 17])('ida y vuelta con %i bytes', async (n) => {
    const k = await keys()
    const plain = rnd(n)
    const cipher = await encryptBytes(k, plain)
    expect(plainSize(cipher.byteLength)).toBe(n)
    expect(Buffer.compare(await decryptBytes(k, cipher), plain)).toBe(0)
  })

  it('detecta un byte cambiado, un archivo truncado y bloques reordenados', async () => {
    const k = await keys()
    const cipher = await encryptBytes(k, rnd(2 * CHUNK_SIZE + 100))
    const flipped = cipher.slice()
    flipped[40] ^= 1
    await expect(decryptBytes(k, flipped)).rejects.toThrow()
    // Truncado justo en el límite de un bloque: sin la marca de "último bloque" no se notaría.
    await expect(decryptBytes(k, cipher.slice(0, 32 + 2 * (CHUNK_SIZE + 16)))).rejects.toThrow()
    const swapped = cipher.slice()
    const a = 32, b = 32 + CHUNK_SIZE + 16, L = CHUNK_SIZE + 16
    swapped.set(cipher.subarray(b, b + L), a)
    swapped.set(cipher.subarray(a, a + L), b)
    await expect(decryptBytes(k, swapped)).rejects.toThrow()
  })

  it('con otra clave no descifra', async () => {
    const cipher = await encryptBytes(await keys(), rnd(500))
    await expect(decryptBytes(await keys(), cipher)).rejects.toThrow()
  })

  it('funciona en streaming con trozos de cualquier tamaño', async () => {
    const k = await keys()
    const plain = rnd(CHUNK_SIZE * 2 + 333)
    const parts: Uint8Array[] = []
    await encryptStream(k, new Blob([plain]).stream(), { write: (c) => void parts.push(c) })
    const cipher = new Uint8Array(await new Blob(parts as Uint8Array<ArrayBuffer>[]).arrayBuffer())
    // Se entrega en trozos irregulares de 7.777 bytes
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(ctl) {
        for (let i = 0; i < cipher.byteLength; i += 7777) ctl.enqueue(cipher.slice(i, i + 7777))
        ctl.close()
      },
    })
    const out: Uint8Array[] = []
    await decryptStream(k, stream, { write: (c) => void out.push(c) })
    expect(Buffer.compare(new Uint8Array(await new Blob(out as Uint8Array<ArrayBuffer>[]).arrayBuffer()), plain)).toBe(0)
  })
})

describe('backup en un disco cifrado', () => {
  const video = rnd(CHUNK_SIZE + 5000)
  async function backup(t: EncryptedMemoryTarget, files = [src('DCIM/IMG_0001.jpg', 'foto secreta de las vacaciones'), src('DCIM/VID_0002.mp4', video)]) {
    return runBackup({
      target: t,
      diskName: 'Cifrado',
      encrypted: true,
      scan: async () => ({ files, ignored: [] }),
      hasher: testHasher,
      readExif: async () => ({ date: null }),
      device: { id: 'd', name: 'Portátil' },
      settings: DEFAULT_SETTINGS,
      control: new Controller(),
      onProgress: () => {},
    })
  }

  it('no deja ver nombres, fechas ni contenido; el backup funciona igual', async () => {
    const t = new EncryptedMemoryTarget(await keys())
    const r = await backup(t)
    expect(r.errors).toEqual([])
    expect(r.copied).toHaveLength(2)
    // Nombres aleatorios, sin el nombre original ni la fecha
    for (const p of t.mediaPaths()) expect(p).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{32}\.bin$/)
    // El manifest en el disco no contiene nada en claro
    const raw = new TextDecoder('latin1').decode(t.files.get(MANIFEST_FILE)!)
    expect(raw).not.toContain('IMG_0001')
    expect(raw).not.toContain('Portátil')
    // Ningún archivo contiene el texto original
    for (const p of t.mediaPaths()) expect(new TextDecoder('latin1').decode(t.files.get(p)!)).not.toContain('vacaciones')
    // Un segundo backup no duplica nada
    const r2 = await backup(t)
    expect(r2.duplicates).toHaveLength(2)
    expect(t.mediaPaths()).toHaveLength(2)
  })

  it('la comprobación de integridad descifra y detecta daños', async () => {
    const t = new EncryptedMemoryTarget(await keys())
    const r = await backup(t)
    const store = (await ManifestStore.open(t, r.diskId!)).store
    expect((await checkIntegrity({ target: t, store, control: noControl })).ok).toBe(2)
    t.files.get(t.mediaPaths()[0])![50] ^= 1
    expect((await checkIntegrity({ target: t, store, control: noControl })).damaged).toHaveLength(1)
  })

  it('sin la clave correcta no se puede abrir el manifest', async () => {
    const t = new EncryptedMemoryTarget(await keys())
    const r = await backup(t)
    const other = new EncryptedMemoryTarget(await keys())
    other.files = t.files
    await expect(ManifestStore.open(other, r.diskId!)).rejects.toThrow()
  })
})
