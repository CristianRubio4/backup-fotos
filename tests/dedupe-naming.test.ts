import { describe, expect, it } from 'vitest'
import { needsPreHash, planDedupe } from '../src/core/dedupe'
import type { ManifestEntry } from '../src/core/manifest/schema'
import { datedName, folderFor, NO_DATE_DIR, pickDate, sanitizeName, withSuffix } from '../src/core/naming'
import { src } from './fakes'

describe('needsPreHash', () => {
  it('solo pide hash de los tamaños repetidos o presentes en el manifest', () => {
    const a = src('a.jpg', 'xxxx')
    const b = src('b.jpg', 'yyyy') // mismo tamaño que a
    const c = src('c.jpg', 'zzzzzz') // tamaño único
    const d = src('d.jpg', 'ww') // tamaño que ya está en el manifest
    const out = needsPreHash([a, b, c, d], (s) => s === 2)
    expect(out.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg', 'd.jpg'])
  })
})

describe('planDedupe', () => {
  it('separa nuevos, ya en el disco y repetidos en la selección', () => {
    const a = src('a.jpg', '1')
    const b = src('copia de a.jpg', '1')
    const c = src('c.jpg', '2')
    const u = src('u.jpg', 'único')
    const existing = { hash: 'H2', diskPath: '2024/05/c.jpg' } as ManifestEntry
    const plan = planDedupe(
      [
        { file: a, hash: 'H1' },
        { file: b, hash: 'H1' },
        { file: c, hash: 'H2' },
        { file: u, hash: null },
      ],
      (hash) => (hash === 'H2' ? existing : undefined),
    )
    expect(plan.toCopy.map((x) => x.file.name)).toEqual(['a.jpg', 'u.jpg'])
    expect(plan.inSelection).toEqual([{ file: b, original: a }])
    expect(plan.onDisk).toEqual([{ file: c, existing }])
  })
})

describe('naming', () => {
  const now = new Date(2026, 9, 9, 12, 0, 0)

  it('prefiere la fecha EXIF', () => {
    const exif = new Date(2023, 6, 1, 9, 5, 7)
    expect(pickDate(exif, now.getTime(), now)).toEqual({ date: exif, source: 'exif' })
  })

  it('usa la fecha del archivo si no hay EXIF', () => {
    const lm = new Date(2022, 1, 3).getTime()
    expect(pickDate(null, lm, now).source).toBe('file')
  })

  it('descarta fechas no fiables (antes de 1990 o futuras)', () => {
    expect(pickDate(null, 0, now).date).toBeNull()
    expect(pickDate(null, new Date(2030, 0, 1).getTime(), now).date).toBeNull()
    expect(pickDate(new Date(1980, 0, 1), 0, now).source).toBe('none')
  })

  it('carpetas año/mes o "Sin fecha"', () => {
    expect(folderFor(new Date(2026, 9, 9))).toBe('2026/10')
    expect(folderFor(null)).toBe(NO_DATE_DIR)
  })

  it('nombre con fecha', () => {
    const d = new Date(2026, 9, 9, 14, 30, 22)
    expect(datedName('IMG_0001.jpg', d, true)).toBe('2026-10-09_143022_IMG_0001.jpg')
    expect(datedName('IMG_0001.jpg', d, false)).toBe('IMG_0001.jpg')
    expect(datedName('IMG_0001.jpg', null, true)).toBe('IMG_0001.jpg')
    expect(datedName('2026-10-09_143022_IMG_0001.jpg', d, true)).toBe('2026-10-09_143022_IMG_0001.jpg')
  })

  it('limpia caracteres no válidos en Windows/exFAT', () => {
    expect(sanitizeName('a:b*c?.jpg')).toBe('a_b_c_.jpg')
    expect(sanitizeName('foto. ')).toBe('foto')
  })

  it('sufijos de conflicto', () => {
    expect(withSuffix('IMG.jpg', 0)).toBe('IMG.jpg')
    expect(withSuffix('IMG.jpg', 2)).toBe('IMG_2.jpg')
    expect(withSuffix('LEEME', 1)).toBe('LEEME_1')
  })
})
