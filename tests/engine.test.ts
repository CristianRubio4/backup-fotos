import { describe, expect, it } from 'vitest'
import { runBackup } from '../src/core/backup/engine'
import { Controller } from '../src/core/control'
import { MANIFEST_BAK, MANIFEST_FILE, parseManifest } from '../src/core/manifest/schema'
import { DEFAULT_SETTINGS, type Settings } from '../src/core/settings'
import type { SourceFile } from '../src/core/types'
import { MemoryTarget, src, testHasher } from './fakes'

const NOW = new Date(2026, 9, 9, 12, 0, 0)
const MAY = new Date(2024, 4, 17, 10, 30, 0).getTime()

function run(target: MemoryTarget, files: SourceFile[], opts: { settings?: Partial<Settings>; control?: Controller } = {}) {
  return runBackup({
    target,
    diskName: 'USB',
    scan: async () => ({ files, ignored: [] }),
    hasher: testHasher,
    readExif: async () => null,
    device: { id: 'dev-1', name: 'Portátil' },
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    control: opts.control ?? new Controller(),
    onProgress: () => {},
    now: () => NOW,
  })
}

async function manifestOf(t: MemoryTarget) {
  return parseManifest(await t.readText(MANIFEST_FILE))!
}

/** Fotos de prueba de tamaños variados (algunos repetidos para forzar hashes). */
function photos(n: number, size = 1000) {
  return Array.from({ length: n }, (_, i) => {
    const bytes = new Uint8Array(size + (i % 3))
    bytes.fill(i + 1)
    return src(`DCIM/IMG_${String(i).padStart(4, '0')}.jpg`, bytes, MAY)
  })
}

describe('runBackup', () => {
  it('copia a año/mes con fecha en el nombre, verifica y escribe el manifest', async () => {
    const t = new MemoryTarget()
    const report = await run(t, [src('DCIM/IMG_1.jpg', 'foto uno', MAY), src('DCIM/IMG_2.jpg', 'foto dos!', MAY)])
    expect(report.outcome).toBe('completed')
    expect(report.copied).toHaveLength(2)
    expect(t.mediaPaths()).toEqual(['2024/05/2024-05-17_103000_IMG_1.jpg', '2024/05/2024-05-17_103000_IMG_2.jpg'])
    const m = await manifestOf(t)
    expect(m.entries.every((e) => e.status === 'verified')).toBe(true)
    expect(m.entries[0]).toMatchObject({ deviceName: 'Portátil', originalName: 'IMG_1.jpg', sourcePath: 'DCIM/IMG_1.jpg' })
  })

  it('un segundo backup no copia nada', async () => {
    const t = new MemoryTarget()
    const files = photos(6)
    await run(t, files)
    const second = await run(t, files)
    expect(second.copied).toHaveLength(0)
    expect(second.duplicates).toHaveLength(6)
    expect(t.mediaPaths()).toHaveLength(6)
  })

  it('duplicados con distinto nombre dentro de la selección: se copia uno', async () => {
    const t = new MemoryTarget()
    const r = await run(t, [src('a/IMG.jpg', 'mismo contenido'), src('b/copia.jpg', 'mismo contenido')])
    expect(r.copied).toHaveLength(1)
    expect(r.duplicates[0].reason).toMatch(/Repetido en la selección/)
  })

  it('mismo nombre y fecha con contenido distinto: añade sufijo', async () => {
    const t = new MemoryTarget()
    await run(t, [src('cam1/IMG.jpg', 'contenido A', MAY)])
    await run(t, [src('cam2/IMG.jpg', 'contenido B distinto', MAY)])
    expect(t.mediaPaths()).toEqual(['2024/05/2024-05-17_103000_IMG.jpg', '2024/05/2024-05-17_103000_IMG_1.jpg'])
  })

  it('archivos de 0 bytes se descartan (y no se tocan en el origen)', async () => {
    const t = new MemoryTarget()
    const r = await run(t, [src('vacio.jpg', '')])
    expect(r.discarded).toHaveLength(1)
    expect(t.mediaPaths()).toHaveLength(0)
  })

  it('si la verificación falla, recopia; si vuelve a fallar no registra el archivo', async () => {
    const t = new MemoryTarget()
    t.corruptNextCopies = 1
    const ok = await run(t, [src('a.jpg', 'foto')])
    expect(ok.copied).toHaveLength(1)
    expect((await manifestOf(t)).entries[0].status).toBe('verified')

    const t2 = new MemoryTarget()
    t2.corruptNextCopies = 2
    const bad = await run(t2, [src('a.jpg', 'foto')])
    expect(bad.errors).toHaveLength(1)
    expect(t2.mediaPaths()).toHaveLength(0)
    expect((await manifestOf(t2)).entries).toHaveLength(0)
  })

  it('sin verificación por hash: estado "unverified"', async () => {
    const t = new MemoryTarget()
    const r = await run(t, [src('a.jpg', 'foto')], { settings: { verifyHash: false } })
    expect(r.unverified).toHaveLength(1)
    expect((await manifestOf(t)).entries[0].status).toBe('unverified')
  })

  it('reanuda tras una desconexión sin duplicar nada', async () => {
    const t = new MemoryTarget()
    const files = photos(40)
    t.disconnectAfterBytes = 25_000 // a mitad del backup
    const first = await run(t, files, { settings: { saveEvery: 5 } })
    expect(first.outcome).toBe('disk-disconnected')
    const copiedBefore = t.mediaPaths().length
    expect(copiedBefore).toBeGreaterThan(0)
    expect(copiedBefore).toBeLessThan(40)

    // Se vuelve a conectar el disco.
    t.disconnected = false
    t.disconnectAfterBytes = null
    const second = await run(t, files)
    expect(second.outcome).toBe('completed')
    expect(t.mediaPaths()).toHaveLength(40) // ni falta ni sobra ninguno (sin "_1")
    expect((await manifestOf(t)).entries).toHaveLength(40)
    // Lo copiado tras el último guardado del diario se reconoce en el disco sin recopiarlo.
    expect(second.copied.length + second.alreadyOnDisk.length + second.duplicates.length).toBe(40)
  })

  it('cancelar guarda en el manifest lo copiado hasta ese momento', async () => {
    const t = new MemoryTarget()
    const control = new Controller()
    const copyIn = t.copyIn.bind(t)
    let copies = 0
    t.copyIn = async (...args) => {
      if (++copies === 5) control.cancel()
      return copyIn(...args)
    }
    const r = await run(t, photos(10), { control })
    expect(r.outcome).toBe('cancelled')
    const m = await manifestOf(t)
    expect(m.entries.length).toBe(t.mediaPaths().length)
    expect(m.entries.length).toBeGreaterThan(0)
  })

  it('manifest y copia dañados: no copia nada y lo indica', async () => {
    const t = new MemoryTarget()
    await t.writeText(MANIFEST_FILE, '{roto')
    await t.writeText(MANIFEST_BAK, '{roto también')
    const r = await run(t, [src('a.jpg', 'foto')])
    expect(r.outcome).toBe('manifest-corrupt')
    expect(t.mediaPaths()).toHaveLength(0)
    expect(await t.readText(MANIFEST_FILE)).toBe('{roto') // no se sobrescribe
  })

  it('un error en un archivo de origen no detiene el resto', async () => {
    const t = new MemoryTarget()
    const broken: SourceFile = { ...src('roto.jpg', 'xx'), getFile: async () => { throw new DOMException('no legible', 'NotReadableError') } }
    const r = await run(t, [broken, src('bien.jpg', 'foto buena')])
    expect(r.outcome).toBe('completed')
    expect(r.errors).toHaveLength(1)
    expect(r.copied).toHaveLength(1)
  })
})
