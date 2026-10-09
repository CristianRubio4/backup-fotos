import { describe, expect, it } from 'vitest'
import { findLivePhotos } from '../src/core/analysis/pairing'
import { src } from './fakes'

const names = (pairs: ReturnType<typeof findLivePhotos>) => pairs.map((p) => [p.photo.relPath, p.video.relPath])

describe('findLivePhotos', () => {
  it('empareja foto y vídeo con el mismo nombre base en la misma carpeta (sin distinguir mayúsculas)', () => {
    const files = [src('DCIM/IMG_1.HEIC', 'a'), src('DCIM/img_1.mov', 'b'), src('DCIM/IMG_2.JPG', 'c'), src('DCIM/IMG_2.MOV', 'd')]
    expect(names(findLivePhotos(files))).toEqual([
      ['DCIM/IMG_1.HEIC', 'DCIM/img_1.mov'],
      ['DCIM/IMG_2.JPG', 'DCIM/IMG_2.MOV'],
    ])
  })

  it('no empareja entre carpetas distintas ni fotos sueltas', () => {
    const files = [src('a/IMG_1.HEIC', 'a'), src('b/IMG_1.MOV', 'b'), src('a/IMG_3.HEIC', 'c'), src('a/VID_4.MOV', 'd')]
    expect(findLivePhotos(files)).toEqual([])
  })

  it('con HEIC y JPG del mismo nombre, el vídeo va con el HEIC', () => {
    const files = [src('IMG_5.JPG', 'a'), src('IMG_5.HEIC', 'b'), src('IMG_5.MOV', 'c')]
    expect(names(findLivePhotos(files))).toEqual([['IMG_5.HEIC', 'IMG_5.MOV']])
  })
})
