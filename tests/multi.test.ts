import { describe, expect, it } from 'vitest'
import { runBackup, type EngineInput } from '../src/core/backup/engine'
import { Controller } from '../src/core/control'
import { DISK_ID_FILE } from '../src/core/disk'
import { MANIFEST_FILE, parseManifest } from '../src/core/manifest/schema'
import { DEFAULT_SETTINGS, type Settings } from './test-settings'
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

describe('una carpeta por copia', () => {
  const snap = (t: MemoryTarget, now: Date, settings: Partial<Settings> = {}) => ({
    settings: { runFolder: true, ...settings },
    openRunFolder: async (name: string) => t.child(name),
    now: () => now,
  })

  it('cada backup crea solo su carpeta, completa, con los archivos de control dentro', async () => {
    const t = new MemoryTarget()
    const r1 = await run(t, [src('IMG_1.jpg', 'a', MAY)], snap(t, new Date(2026, 9, 19, 9, 5, 30)))
    const r2 = await run(t, [src('IMG_1.jpg', 'a', MAY), src('IMG_2.jpg', 'bb', MAY)], snap(t, new Date(2026, 9, 19, 18, 42)))
    expect(r1.folder).toBe('Copia 2026-10-19 09h05')
    expect(r2.folder).toBe('Copia 2026-10-19 18h42')
    // La segunda copia es completa: también lleva IMG_1, aunque ya estuviera en la primera.
    expect(r2.duplicates).toHaveLength(0)
    expect(r2.copied).toHaveLength(2)
    expect(t.mediaPaths()).toEqual([
      'Copia 2026-10-19 09h05/2024-05-17_103000_IMG_1.jpg',
      'Copia 2026-10-19 18h42/2024-05-17_103000_IMG_1.jpg',
      'Copia 2026-10-19 18h42/2024-05-17_103000_IMG_2.jpg',
    ])
    expect(r2.copied.map((c) => c.diskPath)).toContain('Copia 2026-10-19 18h42/2024-05-17_103000_IMG_2.jpg')
    // Nada suelto en la raíz del destino: el disco-id y el manifest van dentro de cada copia.
    const root = [...t.files.keys()].filter((k) => !k.includes('/'))
    expect(root).toEqual([])
    expect(t.files.has(`Copia 2026-10-19 09h05/${MANIFEST_FILE}`)).toBe(true)
    expect(t.files.has(`Copia 2026-10-19 09h05/${DISK_ID_FILE}`)).toBe(true)
  })

  it('la carpeta lleva el nombre del móvil (del EXIF)', async () => {
    const t = new MemoryTarget()
    const exif = async (b: Blob) => ((await b.text()).startsWith('wa') ? { date: null } : { date: null, make: 'samsung', model: 'SM-S911B' })
    const r = await run(t, [src('DCIM/IMG_1.jpg', 'foto 1', MAY), src('DCIM/IMG_2.jpg', 'foto 22', MAY), src('WhatsApp/IMG-WA.jpg', 'wa sin exif', MAY)], {
      ...snap(t, new Date(2026, 9, 19, 14, 30)),
      readExif: exif,
    })
    expect(r.folder).toBe('Samsung SM-S911B - 2026-10-19 14h30')
    expect(t.mediaPaths()).toHaveLength(3)
    expect(t.mediaPaths().every((p) => p.startsWith('Samsung SM-S911B - 2026-10-19 14h30/'))).toBe(true)
  })

  it('copia rápida: cada archivo se lee una sola vez y las repetidas se detectan al copiar', async () => {
    const t = new MemoryTarget()
    const reads = new Map<string, number>()
    const counted = (path: string, content: string) => {
      const f = src(path, content, MAY)
      const get = f.getFile
      return { ...f, getFile: () => (reads.set(path, (reads.get(path) ?? 0) + 1), get()) }
    }
    const files = [
      counted('DCIM/IMG_1.jpg', 'foto repetida'),
      counted('WhatsApp/IMG-WA1.jpg', 'foto repetida'), // mismo contenido y tamaño
      counted('DCIM/IMG_2.jpg', 'otra foto'),
      counted('DCIM/VID_1.mp4', 'un vídeo'),
    ]
    // Como con el móvil por cable: origen lento, sin leer fotos de muestra para adivinar el nombre.
    const r = await run(t, files, { ...snap(t, new Date(2026, 9, 19, 12, 0)), readOnce: true, slowSource: true })
    expect(r.outcome).toBe('completed')
    expect(r.copied.map((c) => c.sourcePath)).toEqual(['DCIM/IMG_1.jpg', 'DCIM/IMG_2.jpg', 'DCIM/VID_1.mp4'])
    expect(r.duplicates.map((d) => d.sourcePath)).toEqual(['WhatsApp/IMG-WA1.jpg'])
    expect([...reads.values()].every((n) => n === 1)).toBe(true) // ni pasada de huellas ni de análisis
    expect(t.mediaPaths()).toHaveLength(3) // la repetida no se queda en el disco
  })

  it('misma estructura de carpetas y nombres que en el móvil', async () => {
    const t = new MemoryTarget()
    const files = [
      src('Galaxy S23/Interno/Pictures/Screenshots/Screenshot_1.png', 'captura', MAY),
      src('Galaxy S23/Interno/DCIM/Camera/IMG_1.jpg', 'foto', MAY),
      src('Galaxy S23/Interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/IMG-WA1.jpg', 'wa', MAY),
    ]
    const r = await run(t, files, { ...snap(t, new Date(2026, 9, 19, 12, 0)), readOnce: true, slowSource: true, sourceName: () => 'Galaxy S23', mirror: { stripFirst: true } })
    expect(t.mediaPaths()).toEqual([
      'Galaxy S23 - 2026-10-19 12h00/Interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/IMG-WA1.jpg',
      'Galaxy S23 - 2026-10-19 12h00/Interno/DCIM/Camera/IMG_1.jpg',
      'Galaxy S23 - 2026-10-19 12h00/Interno/Pictures/Screenshots/Screenshot_1.png',
    ])
    expect(r.copied.map((c) => c.diskPath)).toContain('Galaxy S23 - 2026-10-19 12h00/Interno/Pictures/Screenshots/Screenshot_1.png')
  })

  it('continuar una copia interrumpida: lo ya copiado se salta sin leerlo', async () => {
    const t = new MemoryTarget()
    const cache = new Map<string, string>()
    const hashCache: HashCache = { get: async (f) => cache.get(f.relPath), set: async (f, h) => void cache.set(f.relPath, h) }
    const reads: string[] = []
    const phone = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const f = src(`DCIM/IMG_${i}.jpg`, `foto número ${i}`, MAY)
        return { ...f, getFile: () => (reads.push(f.relPath), f.getFile()) }
      })
    // Primera vez: se corta tras copiar algunas (cancelación).
    const ctl = new Controller()
    const first = await run(t, phone(6), {
      ...snap(t, new Date(2026, 9, 19, 12, 0)),
      readOnce: true,
      slowSource: true,
      hashCache,
      control: ctl,
      onProgress: (p) => {
        if (p.phase === 'copy' && p.counters.copied >= 3) ctl.cancel()
      },
    })
    expect(first.outcome).toBe('cancelled')
    const done = first.copied.length
    expect(done).toBeGreaterThan(0)
    reads.length = 0
    // Continuar en la misma carpeta: solo se leen las que faltaban.
    const second = await run(t, phone(6), { ...snap(t, new Date(2026, 9, 19, 13, 0)), readOnce: true, slowSource: true, hashCache, runFolderName: first.folder })
    expect(second.folder).toBe(first.folder)
    expect(second.copied).toHaveLength(6 - done)
    expect(second.duplicates).toHaveLength(done)
    expect(reads).toHaveLength(6 - done)
    expect(t.mediaPaths().filter((p) => p.startsWith(first.folder!))).toHaveLength(6)
  })

  it('"solo lo nuevo": lo que ya está en otra copia no se copia ni se lee', async () => {
    const t = new MemoryTarget()
    const cache = new Map<string, string>()
    const hashCache: HashCache = { get: async (f) => cache.get(f.relPath), set: async (f, h) => void cache.set(f.relPath, h) }
    const first = await run(t, [src('DCIM/IMG_1.jpg', 'uno', MAY), src('DCIM/IMG_2.jpg', 'dos dos', MAY)], { ...snap(t, new Date(2026, 9, 19, 10, 0)), readOnce: true, slowSource: true, hashCache })
    const known = new Map(parseManifest(await t.readText(`${first.folder}/${MANIFEST_FILE}`))!.entries.map((e) => [e.hash, { ...e, diskPath: `${first.folder}/${e.diskPath}` }]))
    const second = await run(t, [src('DCIM/IMG_1.jpg', 'uno', MAY), src('DCIM/IMG_2.jpg', 'dos dos', MAY), src('DCIM/IMG_3.jpg', 'tres tres tres', MAY)], {
      ...snap(t, new Date(2026, 9, 20, 10, 0)),
      readOnce: true,
      slowSource: true,
      hashCache,
      knownElsewhere: (h) => known.get(h),
    })
    expect(second.copied.map((c) => c.sourcePath)).toEqual(['DCIM/IMG_3.jpg'])
    expect(second.duplicates.map((d) => d.diskPath)).toEqual([`${first.folder}/2024-05-17_103000_IMG_1.jpg`, `${first.folder}/2024-05-17_103000_IMG_2.jpg`])
  })

  it('con "una carpeta por dispositivo", el dispositivo va dentro de la copia', async () => {
    const t = new MemoryTarget()
    await run(t, [src('IMG_1.jpg', 'a', MAY)], { device: { id: 'm', name: 'Móvil de Ana' }, ...snap(t, new Date(2026, 9, 19, 9, 5), { layout: 'per-device' }) })
    expect(t.mediaPaths()).toEqual(['Copia 2026-10-19 09h05/Móvil de Ana/2024-05-17_103000_IMG_1.jpg'])
  })

  it('"Copiar igualmente" va a la misma carpeta de la copia', async () => {
    const t = new MemoryTarget()
    const r = await run(t, [src('IMG_9.jpg', 'x', MAY)], { ...snap(t, new Date(2026, 9, 19, 20, 0)), runFolderName: 'Pixel 8 - 2026-10-19 14h30' })
    expect(r.folder).toBe('Pixel 8 - 2026-10-19 14h30')
    expect(t.mediaPaths()).toEqual(['Pixel 8 - 2026-10-19 14h30/2024-05-17_103000_IMG_9.jpg'])
  })

  it('en un disco cifrado no hay carpeta con fecha', async () => {
    const t = new MemoryTarget()
    const r = await run(t, [src('IMG_1.jpg', 'a', MAY)], { ...snap(t, new Date(2026, 9, 19)), encrypted: true })
    expect(r.folder).toBeUndefined()
  })
})

describe('informe de dónde se ha buscado', () => {
  it('el informe cuenta las carpetas recorridas del origen', async () => {
    const t = new MemoryTarget()
    const r = await run(t, [src('Móvil/DCIM/Camera/a.jpg', 'a', MAY)], {
      scan: async () => ({ files: [src('Móvil/DCIM/Camera/a.jpg', 'a', MAY)], ignored: [], dirs: ['Móvil', 'Móvil/DCIM', 'Móvil/DCIM/Camera'] }),
    })
    expect(r.searched).toEqual({ count: 3, sample: ['Móvil', 'Móvil/DCIM', 'Móvil/DCIM/Camera'] })
  })
})

describe('primer uso de un disco con muchas fotos', () => {
  it('solo relee las del disco que tienen el tamaño de alguna que se va a copiar', async () => {
    const t = new MemoryTarget()
    await t.writeText('Viejas/igual.jpg', 'foto que ya estaba')
    await t.writeText('Viejas/otra.jpg', 'una foto distinta y más larga')
    const hashed: string[] = []
    const hash = t.hash.bind(t)
    t.hash = async (path, onProgress, control) => (hashed.push(path), hash(path, onProgress, control))
    const r = await run(t, [src('DCIM/IMG_1.jpg', 'foto que ya estaba', MAY)])
    expect(hashed).toContain('Viejas/igual.jpg')
    expect(hashed).not.toContain('Viejas/otra.jpg')
    expect(r.duplicates).toHaveLength(1)
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
