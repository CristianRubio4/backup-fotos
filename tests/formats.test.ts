import { describe, expect, it } from 'vitest'
import { bytesSource, byteFeatures, detectFormat, jpegHasEnd, walkBoxes } from '../src/core/analysis/formats'
import { nodeExif, readFixture } from './fixture-set'

const feat = (rel: string) => byteFeatures(bytesSource(readFixture(rel)))

describe('detectFormat (magic bytes)', () => {
  it.each([
    ['DCIM/IMG_0001.jpg', 'jpeg'],
    ['valida.png', 'png'],
    ['DCIM/VID_0001.mp4', 'mp4'],
    ['DCIM/VID_0002.mov', 'mov'],
    ['DCIM/IMG_0100.MOV', 'mov'],
    ['DCIM/IMG_0004.heic', 'heif'],
    ['corrupto.jpg', 'unknown'],
    ['ceros.jpg', 'unknown'],
  ])('%s → %s', (rel, kind) => {
    expect(detectFormat(readFixture(rel).subarray(0, 512)).kind).toBe(kind)
  })

  it('reconoce otros formatos por su firma', () => {
    const b = (s: string) => new TextEncoder().encode(s.padEnd(256, '\0'))
    expect(detectFormat(b('GIF89a')).kind).toBe('gif')
    expect(detectFormat(b('RIFF\0\0\0\0WEBPVP8 ')).kind).toBe('webp')
    expect(detectFormat(b('RIFF\0\0\0\0AVI LIST')).kind).toBe('avi')
    expect(detectFormat(new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])).kind).toBe('tiff')
    expect(detectFormat(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])).kind).toBe('mkv')
    expect(detectFormat(b('\0\0\0\x18ftypcrx \0\0\0\x01crx isom')).kind).toBe('raw')
    expect(detectFormat(b('\0\0\0\x1cftypavif\0\0\0\0avifmif1miaf')).kind).toBe('avif')
    expect(detectFormat(b('\0\0\0\x14ftypmif1\0\0\0\0heic')).kind).toBe('heif')
    expect(detectFormat(b('\0\0\0\x08wide')).kind).toBe('mov')
  })
})

describe('final de JPEG y PNG', () => {
  it('JPEG completo, truncado y con datos detrás (Motion Photo)', async () => {
    expect((await feat('DCIM/IMG_0001.jpg')).hasEnd).toBe(true)
    expect((await feat('truncado.jpg')).hasEnd).toBe(false)
    const motion = await feat('DCIM/MVIMG_0200.jpg')
    expect(motion.motionPhoto).toBe(true)
    expect((await feat('DCIM/IMG_0001.jpg')).motionPhoto).toBe(false)
  })

  it('acepta datos añadidos tras FFD9 (p. ej. Samsung)', () => {
    const tail = new Uint8Array([0x12, 0x00, 0xff, 0xd9, ...new TextEncoder().encode('SEFHxxxxxxxxSEFT')])
    expect(jpegHasEnd(tail)).toBe(true)
  })

  it('PNG completo y truncado', async () => {
    expect((await feat('valida.png')).hasEnd).toBe(true)
    expect((await feat('truncado.png')).hasEnd).toBe(false)
  })

  it('cabecera de ceros', async () => {
    expect((await feat('ceros.jpg')).zeroHeader).toBe(true)
    expect((await feat('corrupto.jpg')).zeroHeader).toBe(false)
  })
})

describe('estructura ISOBMFF (MP4/MOV/HEIC)', () => {
  it('MP4 completo: tiene moov y no está truncado', async () => {
    const w = await walkBoxes(bytesSource(readFixture('DCIM/VID_0001.mp4')))
    expect(w.truncated).toBe(false)
    expect(w.has('ftyp')).toBe(true)
    expect(w.has('moov')).toBe(true)
  })

  it('MP4 cortado a la mitad: truncado', async () => {
    expect((await walkBoxes(bytesSource(readFixture('video-truncado.mp4')))).truncated).toBe(true)
  })

  it('HEIC sintético: estructura correcta', async () => {
    const f = await feat('DCIM/IMG_0004.heic')
    expect(f.boxes).toEqual({ truncated: false, types: ['ftyp', 'meta', 'mdat'] })
  })

  it('box con tamaño de 64 bits', async () => {
    const b = new Uint8Array(32)
    new DataView(b.buffer).setUint32(0, 1)
    b.set(new TextEncoder().encode('mdat'), 4)
    new DataView(b.buffer).setUint32(12, 32)
    expect((await walkBoxes(bytesSource(b))).truncated).toBe(false)
  })
})

describe('EXIF de los archivos de prueba', () => {
  it('lee fecha y dimensiones', async () => {
    const e = await nodeExif(new Blob([readFixture('reducida.jpg')]))
    expect(e.date?.getFullYear()).toBe(2022)
    expect([e.width, e.height]).toEqual([4032, 3024])
  })
})
