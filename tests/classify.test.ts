import { describe, expect, it } from 'vitest'
import { classify, type Features } from '../src/core/analysis/classify'
import type { ByteFeatures } from '../src/core/analysis/formats'
import { emptyKind, laplacianVariance, pixelStats, toGray } from '../src/core/analysis/pixels'
import { DEFAULT_FILTERS, type FilterSettings } from '../src/core/settings'

const goodStats = { mean: 120, std: 50, uniform: 0.1 }
const jpegBytes: ByteFeatures = { kind: 'jpeg', zeroHeader: false, hasEnd: true, motionPhoto: false }

function img(over: Partial<Features> = {}): Features {
  return {
    ext: 'jpg',
    size: 1000,
    media: 'image',
    bytes: jpegBytes,
    decode: { ok: true, width: 4000, height: 3000, stats: goodStats, blur: 300, via: 'browser' },
    ...over,
  }
}

function vid(over: Partial<Features> = {}): Features {
  return {
    ext: 'mov',
    size: 1000,
    media: 'video',
    bytes: { kind: 'mov', zeroHeader: false, boxes: { truncated: false, types: ['ftyp', 'moov', 'mdat'] } },
    video: { ok: true, duration: 12, width: 1920, height: 1080 },
    ...over,
  }
}

const s = (over: Partial<FilterSettings> = {}) => ({ ...DEFAULT_FILTERS, ...over })

describe('classify: imágenes', () => {
  it('foto normal → copiar', () => {
    expect(classify(img(), s())).toEqual({ action: 'copy', status: 'ok' })
  })

  it('cabecera no válida, todo ceros, truncado → corrupto', () => {
    expect(classify(img({ bytes: { kind: 'unknown', zeroHeader: false } }), s())).toMatchObject({ action: 'discard', category: 'corrupt' })
    expect(classify(img({ bytes: { ...jpegBytes, zeroHeader: true } }), s())).toMatchObject({ action: 'discard', category: 'corrupt' })
    expect(classify(img({ bytes: { ...jpegBytes, hasEnd: false } }), s())).toMatchObject({ action: 'discard', category: 'corrupt' })
  })

  it('un JPEG sin FFD9 que es Motion Photo no se descarta', () => {
    expect(classify(img({ bytes: { ...jpegBytes, hasEnd: false, motionPhoto: true } }), s()).action).toBe('copy')
  })

  it('un PNG con extensión .jpg no es un error', () => {
    expect(classify(img({ bytes: { kind: 'png', zeroHeader: false, hasEnd: true } }), s()).action).toBe('copy')
  })

  it('el navegador no la decodifica → corrupto', () => {
    expect(classify(img({ decode: { ok: false, error: 'x', via: 'browser' } }), s())).toMatchObject({ action: 'discard', category: 'corrupt' })
  })

  it('negra, pequeña, borrosa (solo si el filtro está activo)', () => {
    const black = img({ decode: { ok: true, width: 4000, height: 3000, stats: { mean: 2, std: 1, uniform: 1 }, via: 'browser' } })
    expect(classify(black, s())).toMatchObject({ action: 'discard', category: 'empty', reason: 'Imagen negra' })
    expect(classify(black, s({ empty: false })).action).toBe('copy')

    const tiny = img({ decode: { ok: true, width: 160, height: 120, stats: goodStats, via: 'browser' } })
    expect(classify(tiny, s())).toMatchObject({ category: 'small' })
    expect(classify(tiny, s({ minSide: 100 })).action).toBe('copy')

    const blurry = img({ decode: { ok: true, width: 4000, height: 3000, stats: goodStats, blur: 3, via: 'browser' } })
    expect(classify(blurry, s()).action).toBe('copy') // desactivado por defecto
    expect(classify(blurry, s({ blurry: true }))).toMatchObject({ category: 'blurry' })
  })

  it('filtro de corruptos desactivado → copia como no verificado', () => {
    expect(classify(img({ bytes: { ...jpegBytes, hasEnd: false } }), s({ corrupt: false }))).toMatchObject({ action: 'copy', status: 'unverified' })
  })

  it('posible versión reducida: se copia marcada', () => {
    const v = classify(img({ decode: { ok: true, width: 1024, height: 768, stats: goodStats, via: 'browser' }, exifSize: { width: 4032, height: 3024 } }), s())
    expect(v).toMatchObject({ action: 'copy', status: 'reduced' })
  })
})

describe('classify: HEIC nunca se descarta si no se puede verificar', () => {
  const heic = (over: Partial<Features>): Features =>
    img({ ext: 'heic', bytes: { kind: 'heif', zeroHeader: false, boxes: { truncated: false, types: ['ftyp', 'meta', 'mdat'] } }, decode: undefined, ...over })

  it('sin decodificador → no verificado', () => {
    expect(classify(heic({ heifUnavailable: true }), s())).toMatchObject({ action: 'copy', status: 'unverified' })
  })

  it('libheif no la abre pero la estructura es correcta → no verificado', () => {
    expect(classify(heic({ decode: { ok: false, error: 'x', via: 'libheif' } }), s())).toMatchObject({ action: 'copy', status: 'unverified' })
  })

  it('estructura truncada sin poder decodificar → no verificado', () => {
    const t = heic({ bytes: { kind: 'heif', zeroHeader: false, boxes: { truncated: true, types: ['ftyp'] } } })
    expect(classify(t, s())).toMatchObject({ action: 'copy', status: 'unverified' })
  })

  it('estructura truncada y libheif tampoco la abre → corrupto', () => {
    const t = heic({ bytes: { kind: 'heif', zeroHeader: false, boxes: { truncated: true, types: ['ftyp'] } }, decode: { ok: false, error: 'x', via: 'libheif' } })
    expect(classify(t, s())).toMatchObject({ action: 'discard', category: 'corrupt' })
  })

  it('decodificada con libheif → se le aplican los filtros normales', () => {
    expect(classify(heic({ decode: { ok: true, width: 4032, height: 3024, stats: goodStats, via: 'libheif' } }), s())).toEqual({ action: 'copy', status: 'ok' })
  })
})

describe('classify: vídeos', () => {
  it('vídeo normal', () => {
    expect(classify(vid(), s())).toEqual({ action: 'copy', status: 'ok' })
  })

  it('truncado o sin moov → corrupto', () => {
    expect(classify(vid({ bytes: { kind: 'mp4', zeroHeader: false, boxes: { truncated: true, types: ['ftyp'] } } }), s())).toMatchObject({ category: 'corrupt' })
    expect(classify(vid({ bytes: { kind: 'mp4', zeroHeader: false, boxes: { truncated: false, types: ['ftyp', 'mdat'] } } }), s())).toMatchObject({ category: 'corrupt' })
  })

  it('el navegador no lo reproduce (HEVC) pero la estructura es buena → no verificado', () => {
    expect(classify(vid({ video: { ok: false, error: 'códec' } }), s())).toMatchObject({ action: 'copy', status: 'unverified' })
  })

  it('duración 0 → corrupto', () => {
    expect(classify(vid({ video: { ok: true, duration: 0, width: 0, height: 0 } }), s())).toMatchObject({ category: 'corrupt' })
  })

  it('vídeo corto: se descarta solo con el filtro activo y nunca si es de una Live Photo', () => {
    const short = vid({ video: { ok: true, duration: 0.4, width: 1, height: 1 } })
    expect(classify(short, s()).action).toBe('copy')
    expect(classify(short, s({ shortVideo: true }))).toMatchObject({ category: 'short' })
    expect(classify({ ...short, livePhotoVideo: true }, s({ shortVideo: true })).action).toBe('copy')
  })
})

describe('pixels', () => {
  const solid = (r: number, g: number, b: number, n = 64 * 64) => {
    const a = new Uint8Array(n * 4)
    for (let i = 0; i < a.length; i += 4) a.set([r, g, b, 255], i)
    return a
  }

  it('detecta negra, blanca y de un color', () => {
    expect(emptyKind(pixelStats(solid(0, 0, 0)), 4)).toBe('negra')
    expect(emptyKind(pixelStats(solid(255, 255, 255)), 4)).toBe('blanca')
    expect(emptyKind(pixelStats(solid(30, 120, 200)), 4)).toBe('de un solo color')
  })

  it('no considera vacía una foto nocturna con detalles', () => {
    const night = solid(5, 5, 10)
    for (let i = 0; i < night.length; i += 4 * 37) night.set([250, 250, 250, 255], i) // estrellas
    expect(emptyKind(pixelStats(night), 4)).toBeNull()
  })

  it('el Laplaciano distingue nítida de borrosa', () => {
    const w = 64, h = 64
    const sharp = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sharp.set((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * w + x) * 4)
    const flat = solid(128, 128, 128, w * h)
    expect(laplacianVariance(toGray(sharp), w, h)).toBeGreaterThan(1000)
    expect(laplacianVariance(toGray(flat), w, h)).toBe(0)
  })
})
