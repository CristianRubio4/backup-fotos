import exifr from 'exifr'
import { describe, expect, it } from 'vitest'
import { runBackup } from '../src/core/backup/engine'
import { Controller } from '../src/core/control'
import { buildExifApp1, insertApp1 } from '../src/core/exif-writer'
import { MANIFEST_FILE, parseManifest } from '../src/core/manifest/schema'
import { DEFAULT_SETTINGS } from './test-settings'
import { MemoryTarget, src, testHasher } from './fakes'

// JPEG mínimo (inicio y fin), sin EXIF propio: así lo que se lee es solo lo que se ha escrito.
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

describe('EXIF de los JPG convertidos desde HEIC', () => {
  it('fecha, cámara y ubicación se leen igual que en la original', async () => {
    const taken = new Date(2024, 6, 14, 18, 22, 5)
    const app1 = buildExifApp1({ make: 'Apple', model: 'iPhone 15 Pro', taken, latitude: 40.416775, longitude: -3.70379, altitude: 657.4 })!
    const jpeg = insertApp1(JPG, app1)
    expect(jpeg[0]).toBe(0xff)
    expect(jpeg[1]).toBe(0xd8)
    const d = await exifr.parse(jpeg, { tiff: true, exif: true, gps: true })
    expect(d.Make).toBe('Apple')
    expect(d.Model).toBe('iPhone 15 Pro')
    expect((d.DateTimeOriginal as Date).getTime()).toBe(taken.getTime())
    expect(d.latitude).toBeCloseTo(40.416775, 4)
    expect(d.longitude).toBeCloseTo(-3.70379, 4)
    expect(d.GPSAltitude).toBeCloseTo(657.4, 1)
  })

  it('sin datos no se añade nada', () => {
    expect(buildExifApp1({})).toBeNull()
  })

  it('solo la fecha (p. ej. sin ubicación)', async () => {
    const taken = new Date(2023, 0, 2, 3, 4, 5)
    const d = await exifr.parse(insertApp1(JPG, buildExifApp1({ taken })!), { tiff: true, exif: true, gps: true })
    expect((d.DateTimeOriginal as Date).getTime()).toBe(taken.getTime())
    expect(d.latitude).toBeUndefined()
  })
})

describe('backup con HEIC → JPG', () => {
  const MAY = new Date(2024, 4, 17, 10, 30).getTime()
  const base = (t: MemoryTarget, convertHeic: (b: Blob) => Promise<Blob | null>) => ({
    target: t,
    diskName: 'USB',
    hasher: testHasher,
    readExif: async () => ({ date: null }),
    device: { id: 'pc', name: 'PC' },
    settings: { ...DEFAULT_SETTINGS, runFolder: true },
    control: new Controller(),
    onProgress: () => {},
    now: () => new Date(2026, 9, 20, 9, 0),
    openRunFolder: async (n: string) => t.child(n),
    readOnce: true,
    slowSource: true,
    sourceName: () => 'iPhone',
    mirror: { stripFirst: true },
    convertHeic,
  })

  it('en el disco queda solo el JPG, en la misma carpeta', async () => {
    const t = new MemoryTarget()
    const files = [src('iPhone/DCIM/100APPLE/IMG_0001.HEIC', 'heic original', MAY), src('iPhone/DCIM/100APPLE/IMG_0002.JPG', 'jpg normal', MAY)]
    const r = await runBackup({ ...base(t, async () => new Blob(['jpg convertido'])), scan: async () => ({ files, ignored: [] }) })
    expect(r.outcome).toBe('completed')
    expect(t.mediaPaths()).toEqual(['iPhone - 2026-10-20 09h00/DCIM/100APPLE/IMG_0001.jpg', 'iPhone - 2026-10-20 09h00/DCIM/100APPLE/IMG_0002.JPG'])
    expect(await (await t.readFile('iPhone - 2026-10-20 09h00/DCIM/100APPLE/IMG_0001.jpg'))!.text()).toBe('jpg convertido')
    const m = parseManifest(await t.readText(`${r.folder}/.backup-ignore/${MANIFEST_FILE}`))!
    expect(m.entries.find((e) => e.diskPath.endsWith('IMG_0001.jpg'))!.note).toMatch(/Convertida de HEIC a JPG \(original: IMG_0001.HEIC\)/)
  })

  it('si una HEIC no se puede convertir bien, se guarda la HEIC (nunca se pierde)', async () => {
    const t = new MemoryTarget()
    const files = [src('iPhone/DCIM/IMG_0003.HEIC', 'heic rara', MAY)]
    await runBackup({ ...base(t, async () => null), scan: async () => ({ files, ignored: [] }) })
    expect(t.mediaPaths()).toEqual(['iPhone - 2026-10-20 09h00/DCIM/IMG_0003.HEIC'])
  })

  it('al continuar la copia, las ya convertidas no se repiten', async () => {
    const t = new MemoryTarget()
    let conversions = 0
    const convert = async () => (conversions++, new Blob(['jpg']))
    const files = [src('iPhone/DCIM/IMG_0001.HEIC', 'h1', MAY)]
    const first = await runBackup({ ...base(t, convert), scan: async () => ({ files, ignored: [] }) })
    const again = await runBackup({ ...base(t, convert), scan: async () => ({ files, ignored: [] }), runFolderName: first.folder })
    expect(again.copied).toHaveLength(0)
    expect(conversions).toBe(1)
    expect(t.mediaPaths()).toHaveLength(1)
  })
})
