import fs from 'node:fs'
import path from 'node:path'
import exifr from 'exifr'
import type { Features } from '../src/core/analysis/classify'
import { blobSource, byteFeatures } from '../src/core/analysis/formats'
import type { Analyzer, ExifInfo, SourceFile } from '../src/core/types'

export const SET_DIR = path.join(__dirname, 'fixtures', 'set')

export function readFixture(rel: string) {
  return new Uint8Array(fs.readFileSync(path.join(SET_DIR, rel)))
}

/** Los archivos de tests/fixtures/set como SourceFile. */
export function loadSet(dir = SET_DIR, prefix = ''): SourceFile[] {
  const out: SourceFile[] = []
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    const st = fs.statSync(full)
    if (st.isDirectory()) out.push(...loadSet(full, rel))
    else {
      out.push({
        relPath: rel,
        name,
        size: st.size,
        lastModified: new Date(2026, 0, 15, 12, 0, 0).getTime(),
        getFile: async () => new Blob([new Uint8Array(fs.readFileSync(full))]),
      })
    }
  }
  return out
}

/** Lector EXIF real (exifr), igual que el del Worker. */
export async function nodeExif(file: Blob): Promise<ExifInfo> {
  const head = await file.slice(0, 512 * 1024).arrayBuffer()
  const d = await exifr.parse(head, { pick: ['DateTimeOriginal', 'CreateDate', 'PixelXDimension', 'PixelYDimension', 'ExifImageWidth', 'ExifImageHeight'] })
  const date = d?.DateTimeOriginal ?? d?.CreateDate
  return {
    date: date instanceof Date ? date : null,
    width: d?.PixelXDimension ?? d?.ExifImageWidth,
    height: d?.PixelYDimension ?? d?.ExifImageHeight,
  }
}

/**
 * Analizador para Node: solo bytes (en Node no hay decodificador de imágenes
 * ni <video>). Opcionalmente se le inyectan resultados de decodificación.
 */
export function byteAnalyzer(extra: (name: string) => Partial<Features> = () => ({})): Analyzer {
  return {
    async analyze(file, info) {
      return {
        ext: info.ext,
        size: file.size,
        media: info.media,
        bytes: await byteFeatures(blobSource(file)),
        livePhotoVideo: info.livePhotoVideo,
        exifSize: info.exif.width && info.exif.height ? { width: info.exif.width, height: info.exif.height } : undefined,
        ...extra(info.name),
      }
    },
  }
}
