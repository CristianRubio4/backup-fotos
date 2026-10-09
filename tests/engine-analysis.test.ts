import { describe, expect, it } from 'vitest'
import type { Features } from '../src/core/analysis/classify'
import { runBackup } from '../src/core/backup/engine'
import { Controller } from '../src/core/control'
import { MANIFEST_FILE, parseManifest } from '../src/core/manifest/schema'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import type { SourceFile } from '../src/core/types'
import { MemoryTarget, testHasher } from './fakes'
import { byteAnalyzer, loadSet, nodeExif } from './fixture-set'

// En Node no hay decodificador de imágenes ni <video>: se inyecta lo que
// mediría el navegador para cada archivo de prueba (el resto se mide de verdad).
const good = { mean: 120, std: 45, uniform: 0.05 }
function simulatedBrowser(name: string): Partial<Features> {
  const ok = (width: number, height: number, stats = good) => ({ decode: { ok: true as const, width, height, stats, blur: 200, via: 'browser' as const } })
  if (name === 'negra.jpg') return ok(1024, 768, { mean: 0, std: 0.5, uniform: 1 })
  if (name === 'blanca.png') return ok(800, 600, { mean: 255, std: 0, uniform: 1 })
  if (name === 'diminuta.jpg') return ok(160, 120)
  if (name === 'reducida.jpg') return ok(512, 384)
  if (name.endsWith('.heic')) return { decode: { ok: false, error: 'no es una imagen HEVC real', via: 'libheif' } }
  if (/\.(mp4|mov)$/i.test(name)) return { video: { ok: true, duration: 2, width: 320, height: 240 } }
  return ok(1024, 768)
}

function run(target: MemoryTarget, files: SourceFile[], force?: Set<string>) {
  return runBackup({
    target,
    diskName: 'USB',
    scan: async () => ({ files: files.filter((f) => f.name !== 'notas.txt'), ignored: ['notas.txt'] }),
    hasher: testHasher,
    readExif: nodeExif,
    analyzer: byteAnalyzer(simulatedBrowser),
    force,
    device: { id: 'dev', name: 'Portátil' },
    settings: DEFAULT_SETTINGS,
    control: new Controller(),
    onProgress: () => {},
    now: () => new Date(2026, 9, 9, 12, 0, 0),
  })
}

describe('backup del conjunto de prueba', () => {
  it('descarta lo que no sirve, copia el resto y empareja Live/Motion Photos', async () => {
    const t = new MemoryTarget()
    const r = await run(t, loadSet())
    expect(r.outcome).toBe('completed')

    const discarded = Object.fromEntries(r.discarded.map((d) => [d.sourcePath, d.category]))
    expect(discarded).toEqual({
      'vacio.jpg': 'corrupt',
      'corrupto.jpg': 'corrupt',
      'ceros.jpg': 'corrupt',
      'truncado.jpg': 'corrupt',
      'truncado.png': 'corrupt',
      'video-truncado.mp4': 'corrupt',
      'negra.jpg': 'empty',
      'blanca.png': 'empty',
      'diminuta.jpg': 'small',
    })
    expect(r.duplicates.map((d) => d.sourcePath)).toEqual(['copia de IMG_0001.jpg'])
    expect(r.unverified.map((d) => d.sourcePath)).toEqual(['DCIM/IMG_0004.heic'])
    expect(r.reduced.map((d) => d.sourcePath)).toEqual(['reducida.jpg'])
    expect(r.copied).toHaveLength(12)
    expect(r.livePhotos).toBe(1)
    expect(r.motionPhotos).toBe(1)

    const paths = t.mediaPaths()
    // Carpeta y nombre según la fecha EXIF
    expect(paths).toContain('2023/07/2023-07-14_182205_IMG_0001.jpg')
    // La Live Photo: foto y vídeo juntos, con el mismo nombre base (el vídeo no tiene EXIF)
    expect(paths).toContain('2025/06/2025-06-01_201530_IMG_0100.jpg')
    expect(paths).toContain('2025/06/2025-06-01_201530_IMG_0100.MOV')
    // Los descartados no están en el disco
    expect(paths.some((p) => p.includes('negra') || p.includes('truncado'))).toBe(false)

    const m = parseManifest(await t.readText(MANIFEST_FILE))!
    const by = (name: string) => m.entries.find((e) => e.originalName === name)!
    expect(by('IMG_0100.MOV').pair).toBe(by('IMG_0100.jpg').hash)
    expect(by('IMG_0100.jpg').pair).toBe(by('IMG_0100.MOV').hash)
    expect(by('MVIMG_0200.jpg').motionPhoto).toBe(true)
    expect(by('reducida.jpg').status).toBe('reduced')
    expect(by('IMG_0004.heic').status).toBe('unverified')
    expect(by('IMG_0001.jpg').status).toBe('verified')
  })

  it('"Copiar igualmente": copia un descartado marcado como no verificado', async () => {
    const t = new MemoryTarget()
    const files = loadSet()
    await run(t, files)
    const r = await run(t, files.filter((f) => f.name === 'negra.jpg'), new Set(['negra.jpg']))
    expect(r.copied.map((c) => c.sourcePath)).toEqual(['negra.jpg'])
    const m = parseManifest(await t.readText(MANIFEST_FILE))!
    expect(m.entries.find((e) => e.originalName === 'negra.jpg')).toMatchObject({ status: 'unverified' })
  })

  it('el vídeo de una Live Photo cuya foto ya estaba en el disco se coloca junto a ella', async () => {
    const t = new MemoryTarget()
    const files = loadSet()
    await run(t, files.filter((f) => f.name !== 'IMG_0100.MOV'))
    const r = await run(t, files)
    expect(r.copied.map((c) => c.diskPath)).toEqual(['2025/06/2025-06-01_201530_IMG_0100.MOV'])
  })

  it('si el analizador falla, el archivo se copia como no verificado (nunca se descarta)', async () => {
    const t = new MemoryTarget()
    const r = await runBackup({
      target: t,
      diskName: 'USB',
      scan: async () => ({ files: loadSet().filter((f) => f.name === 'IMG_0001.jpg'), ignored: [] }),
      hasher: testHasher,
      readExif: nodeExif,
      analyzer: { analyze: async () => { throw new Error('fallo del decodificador') } },
      device: { id: 'dev', name: 'Portátil' },
      settings: DEFAULT_SETTINGS,
      control: new Controller(),
      onProgress: () => {},
    })
    expect(r.copied).toHaveLength(1)
    expect(r.unverified[0].reason).toMatch(/No se pudo analizar/)
  })
})
