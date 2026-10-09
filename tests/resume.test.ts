import { describe, expect, it } from 'vitest'
import { runBackup, type EngineInput } from '../src/core/backup/engine'
import { Controller } from '../src/core/control'
import { readDiskId } from '../src/core/disk'
import { MANIFEST_FILE, parseManifest } from '../src/core/manifest/schema'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import { CancelledError, type SourceFile } from '../src/core/types'
import { MemoryTarget, src, testHasher } from './fakes'

function photos(n: number, size = 1000) {
  return Array.from({ length: n }, (_, i) => {
    const bytes = new Uint8Array(size + (i % 3))
    bytes.fill(i + 1)
    return src(`DCIM/IMG_${String(i).padStart(4, '0')}.jpg`, bytes)
  })
}

function run(target: MemoryTarget, files: SourceFile[], extra: Partial<EngineInput> = {}) {
  return runBackup({
    target,
    diskName: 'USB',
    scan: async () => ({ files, ignored: [] }),
    hasher: testHasher,
    readExif: async () => ({ date: null }),
    device: { id: 'dev', name: 'Portátil' },
    settings: { ...DEFAULT_SETTINGS, saveEvery: 5 },
    control: new Controller(),
    onProgress: () => {},
    ...extra,
  })
}

const entries = async (t: MemoryTarget) => parseManifest(await t.readText(MANIFEST_FILE))!.entries

describe('desconexión del disco con reanudación automática', () => {
  it('espera a que vuelva el disco y continúa sin duplicar nada', async () => {
    const t = new MemoryTarget()
    t.disconnectAfterBytes = 15_000
    const waits: string[] = []
    let sawWaiting = false
    const r = await run(t, photos(40), {
      waitForDisk: async (id) => {
        waits.push(id)
        t.disconnected = false
        t.disconnectAfterBytes = null
      },
      onProgress: (p) => (sawWaiting ||= p.waitingDisk),
    })
    expect(r.outcome).toBe('completed')
    expect(waits).toEqual([r.diskId])
    expect(sawWaiting).toBe(true)
    expect(t.mediaPaths()).toHaveLength(40) // ninguno duplicado (sin "_1")
    expect(await entries(t)).toHaveLength(40)
    expect(r.errors).toHaveLength(0)
  })

  it('soporta varias desconexiones seguidas', async () => {
    const t = new MemoryTarget()
    t.disconnectAfterBytes = 8_000
    let waits = 0
    const r = await run(t, photos(40), {
      waitForDisk: async () => {
        waits++
        t.disconnected = false
        t.disconnectAfterBytes = waits < 3 ? t.disconnectAfterBytes! + 12_000 : null
      },
    })
    expect(r.outcome).toBe('completed')
    expect(waits).toBe(3)
    expect(t.mediaPaths()).toHaveLength(40)
  })

  it('si se cancela mientras espera, el siguiente backup completa lo que faltaba', async () => {
    const t = new MemoryTarget()
    t.disconnectAfterBytes = 20_000
    const first = await run(t, photos(40), { waitForDisk: async () => { throw new CancelledError() } })
    expect(first.outcome).toBe('disk-disconnected') // no se pudo guardar al final: el disco no estaba
    t.disconnected = false
    t.disconnectAfterBytes = null
    const second = await run(t, photos(40))
    expect(second.outcome).toBe('completed')
    expect(t.mediaPaths()).toHaveLength(40)
    expect(await entries(t)).toHaveLength(40)
  })

  it('el disco recuerda su identificador', async () => {
    const t = new MemoryTarget()
    const r = await run(t, photos(1))
    expect((await readDiskId(t))?.id).toBe(r.diskId)
    expect(await readDiskId(new MemoryTarget())).toBeNull()
  })
})

describe('FAT32 (archivos de más de 4 GB)', () => {
  it('informa de los archivos grandes, no reintenta los siguientes y copia el resto', async () => {
    const t = new MemoryTarget()
    t.maxFileSize = 1500 // como FAT32, a escala
    const files = [src('a.jpg', new Uint8Array(100).fill(1)), src('grande1.mp4', new Uint8Array(2000).fill(2)), src('b.jpg', new Uint8Array(120).fill(3)), src('grande2.mp4', new Uint8Array(3000).fill(4))]
    const r = await run(t, files, { fat32Limit: 1500 })
    expect(r.outcome).toBe('completed') // no se interrumpe el backup
    expect(r.fat32.map((x) => x.sourcePath)).toEqual(['grande1.mp4', 'grande2.mp4'])
    expect(r.copied.map((x) => x.sourcePath).sort()).toEqual(['a.jpg', 'b.jpg'])
    // Solo se intentó copiar el primer archivo grande
    expect(t.copyAttempts.filter((p) => p.includes('grande'))).toHaveLength(1)
  })

  it('un disco lleno con archivos pequeños sí detiene el backup', async () => {
    const t = new MemoryTarget()
    t.maxFileSize = 50
    const r = await run(t, [src('a.jpg', new Uint8Array(100).fill(1))], { fat32Limit: 1500 })
    expect(r.outcome).toBe('disk-full')
  })
})
