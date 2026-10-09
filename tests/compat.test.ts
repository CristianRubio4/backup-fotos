import { describe, expect, it } from 'vitest'
import type { Features } from '../src/core/analysis/classify'
import { planCompat, splitBatches } from '../src/core/compat/plan'
import { noControl } from '../src/core/control'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import { src, testHasher } from './fakes'
import { byteAnalyzer, loadSet, nodeExif } from './fixture-set'

const good = { mean: 120, std: 45, uniform: 0.05 }
const browser = (name: string): Partial<Features> => {
  if (name === 'negra.jpg') return { decode: { ok: true, width: 1024, height: 768, stats: { mean: 0, std: 0, uniform: 1 }, via: 'browser' } }
  if (/\.(mp4|mov)$/i.test(name)) return { video: { ok: true, duration: 2, width: 320, height: 240 } }
  if (name.endsWith('.heic')) return {}
  return { decode: { ok: true, width: 1024, height: 768, stats: good, via: 'browser' } }
}

function plan(files = loadSet().filter((f) => f.name !== 'notas.txt'), known = new Set<string>()) {
  return planCompat({
    files,
    isKnown: (h) => known.has(h),
    hasher: testHasher,
    readExif: nodeExif,
    analyzer: byteAnalyzer(browser),
    settings: DEFAULT_SETTINGS,
    device: { id: 'iphone', name: 'iPhone de Ana' },
    control: noControl,
    now: () => new Date(2026, 9, 9),
  })
}

describe('modo compatible', () => {
  it('mismo análisis y antiduplicados que el modo completo; rutas año/mes en el ZIP', async () => {
    const p = await plan()
    expect(p.duplicates.map((d) => d.sourcePath)).toEqual(['copia de IMG_0001.jpg'])
    expect(p.discarded.map((d) => d.sourcePath)).toContain('truncado.jpg')
    expect(p.discarded.map((d) => d.sourcePath)).toContain('negra.jpg')
    const paths = p.items.map((i) => i.zipPath)
    expect(paths).toContain('2023/07/2023-07-14_182205_IMG_0001.jpg')
    expect(paths).toContain('2025/06/2025-06-01_201530_IMG_0100.jpg')
    expect(paths).toContain('2025/06/2025-06-01_201530_IMG_0100.MOV')
    expect(new Set(paths.map((x) => x.toLowerCase())).size).toBe(paths.length)
    // Nunca "verificado": la copia no se ha comprobado en un disco
    expect(p.items.every((i) => i.entry.status !== 'verified')).toBe(true)
  })

  it('omite lo ya guardado (historial de ZIP o manifest del disco)', async () => {
    const first = await plan()
    const known = new Set(first.items.map((i) => i.hash))
    const second = await plan(undefined, known)
    expect(second.items).toHaveLength(0)
    expect(second.duplicates.length).toBe(first.items.length + 1)
  })

  it('lotes con tamaño máximo sin separar las Live Photos', async () => {
    const p = await plan()
    const batches = splitBatches(p.items, 300_000)
    expect(batches.length).toBeGreaterThan(1)
    for (const b of batches) {
      const names = b.map((i) => i.file.name)
      if (names.includes('IMG_0100.jpg')) expect(names).toContain('IMG_0100.MOV')
    }
    expect(batches.flat()).toHaveLength(p.items.length)
  })

  it('detecta fotos de iPhone convertidas a JPEG por Safari', async () => {
    const appleJpeg = { ...src('IMG_5000.jpg', 'jpeg convertido'), lastModified: new Date(2026, 9, 9).getTime() }
    const p = await planCompat({
      files: [appleJpeg],
      isKnown: () => false,
      hasher: testHasher,
      readExif: async () => ({ date: new Date(2026, 9, 1), make: 'Apple' }),
      settings: DEFAULT_SETTINGS,
      device: { id: 'i', name: 'iPhone' },
      control: noControl,
      isIOS: true,
      now: () => new Date(2026, 9, 9, 0, 5),
    })
    expect(p.convertedByIOS).toEqual(['IMG_5000.jpg'])
    expect(p.appleWithoutVideo).toBe(1)
  })
})
