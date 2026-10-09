import { describe, expect, it } from 'vitest'
import { runBackup, type EngineInput } from '../src/core/backup/engine'
import { Controller } from '../src/core/control'
import { MANIFEST_FILE, parseManifest } from '../src/core/manifest/schema'
import { DEFAULT_SETTINGS, type Settings } from '../src/core/settings'
import type { HashCache, SourceFile } from '../src/core/types'
import { MemoryTarget, src, testHasher } from './fakes'

const MAY = new Date(2024, 4, 17, 10, 30, 0).getTime()

function run(target: MemoryTarget, files: SourceFile[], extra: Omit<Partial<EngineInput>, 'settings'> & { settings?: Partial<Settings> } = {}) {
  const { settings, ...rest } = extra
  return runBackup({
    target,
    diskName: 'USB',
    scan: async () => ({ files, ignored: [] }),
    hasher: testHasher,
    readExif: async () => ({ date: null }),
    device: { id: 'dev-1', name: 'Portátil' },
    settings: { ...DEFAULT_SETTINGS, ...settings },
    control: new Controller(),
    onProgress: () => {},
    now: () => new Date(2026, 9, 9),
    ...rest,
  })
}

describe('varios dispositivos', () => {
  it('detecta duplicados entre dispositivos (mismo backup compartido)', async () => {
    const t = new MemoryTarget()
    await run(t, [src('DCIM/IMG_1.jpg', 'foto compartida por WhatsApp', MAY)], { device: { id: 'movil', name: 'Móvil de Ana' } })
    const r = await run(t, [src('WhatsApp/IMG-2024.jpg', 'foto compartida por WhatsApp', MAY)], { device: { id: 'pc', name: 'Portátil' } })
    expect(r.copied).toHaveLength(0)
    expect(r.duplicates).toHaveLength(1)
    const m = parseManifest(await t.readText(MANIFEST_FILE))!
    expect(m.entries[0].deviceName).toBe('Móvil de Ana')
  })

  it('opción "una carpeta por dispositivo"', async () => {
    const t = new MemoryTarget()
    await run(t, [src('IMG_1.jpg', 'a', MAY)], { device: { id: 'm', name: 'Móvil de Ana' }, settings: { layout: 'per-device' } })
    await run(t, [src('IMG_2.jpg', 'bb', MAY)], { device: { id: 'p', name: 'Portátil: casa' }, settings: { layout: 'per-device' } })
    expect(t.mediaPaths()).toEqual(['Móvil de Ana/2024/05/2024-05-17_103000_IMG_1.jpg', 'Portátil_ casa/2024/05/2024-05-17_103000_IMG_2.jpg'])
  })
})

describe('caché de hashes del origen', () => {
  it('no recalcula el hash de archivos sin cambios', async () => {
    const store = new Map<string, { size: number; lastModified: number; hash: string }>()
    const cache: HashCache = {
      async get(f) {
        const c = store.get(f.relPath)
        return c && c.size === f.size && c.lastModified === f.lastModified ? c.hash : undefined
      },
      async set(f, hash) {
        store.set(f.relPath, { size: f.size, lastModified: f.lastModified, hash })
      },
    }
    let hashed = 0
    const hasher = { hash: async (...a: Parameters<typeof testHasher.hash>) => (hashed++, testHasher.hash(...a)) }
    const t = new MemoryTarget()
    const files = Array.from({ length: 10 }, (_, i) => src(`IMG_${i}.jpg`, `foto número ${i}`.padEnd(30, '.'), MAY)) // mismo tamaño: todos necesitan hash
    await run(t, files, { hashCache: cache, hasher })
    const first = hashed
    hashed = 0
    const r = await run(t, files, { hashCache: cache, hasher })
    expect(first).toBeGreaterThan(0)
    expect(hashed).toBe(0) // segundo backup: todo sale de la caché
    expect(r.duplicates).toHaveLength(10)

    // Un archivo modificado (otra fecha) sí se vuelve a calcular
    hashed = 0
    const changed = [...files.slice(1), src('IMG_0.jpg', 'foto número 0 editada'.padEnd(30, '.'), MAY + 1000)]
    const r2 = await run(t, changed, { hashCache: cache, hasher })
    expect(hashed).toBe(1)
    expect(r2.copied).toHaveLength(1)
  })
})

describe('primer uso de un disco con fotos previas', () => {
  it('incorpora al manifest las fotos que ya había y no las duplica', async () => {
    const t = new MemoryTarget()
    await t.writeText('Fotos viejas/2019/verano.jpg', 'foto copiada a mano hace años')
    await t.writeText('Fotos viejas/2019/copia de verano.jpg', 'foto copiada a mano hace años')
    await t.writeText('Documentos/factura.pdf', 'no es una foto')
    const r = await run(t, [src('DCIM/IMG_9.jpg', 'foto copiada a mano hace años', MAY), src('DCIM/IMG_10.jpg', 'foto nueva', MAY)])
    expect(r.incorporated).toBe(1)
    expect(r.duplicates.map((d) => d.sourcePath)).toEqual(['DCIM/IMG_9.jpg'])
    expect(r.copied.map((d) => d.sourcePath)).toEqual(['DCIM/IMG_10.jpg'])
    const m = parseManifest(await t.readText(MANIFEST_FILE))!
    const old = m.entries.filter((e) => e.diskPath.startsWith('Fotos viejas/'))
    expect(old).toHaveLength(1) // las dos copias son idénticas: se registra una
    expect(old[0]).toMatchObject({ status: 'verified', deviceName: 'Ya estaba en el disco' })
    // Los archivos previos no se tocan
    expect(t.mediaPaths()).toContain('Fotos viejas/2019/copia de verano.jpg')
    expect(t.mediaPaths()).toContain('Documentos/factura.pdf')
  })

  it('solo lo hace la primera vez (cuando el disco aún no tiene manifest)', async () => {
    const t = new MemoryTarget()
    await run(t, [src('a.jpg', 'a', MAY)])
    await t.writeText('suelta.jpg', 'copiada a mano después')
    const r = await run(t, [src('b.jpg', 'bb', MAY)])
    expect(r.incorporated).toBe(0)
  })
})
