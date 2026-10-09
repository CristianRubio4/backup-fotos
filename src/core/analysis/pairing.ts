import { extOf } from '../media'
import type { SourceFile } from '../types'

// Live Photos (iPhone): una foto (HEIC/JPG) y un vídeo corto (MOV) con el
// mismo nombre base en la misma carpeta, p. ej. IMG_1234.HEIC + IMG_1234.MOV.
//
// iOS también guarda un identificador común (ContentIdentifier) dentro de
// ambos archivos, pero leerlo de forma fiable exige analizar la MakerNote de
// Apple; el nombre base es lo que conservan tanto la transferencia por cable
// como la app Archivos, así que se usa eso.

const PHOTO_EXT = ['heic', 'heif', 'jpg', 'jpeg']
const VIDEO_EXT = ['mov', 'mp4']

export interface LivePair {
  photo: SourceFile
  video: SourceFile
}

function key(f: SourceFile) {
  const slash = f.relPath.lastIndexOf('/')
  const dir = slash >= 0 ? f.relPath.slice(0, slash) : ''
  const dot = f.name.lastIndexOf('.')
  const base = dot > 0 ? f.name.slice(0, dot) : f.name
  return `${dir}/${base}`.toLowerCase()
}

export function findLivePhotos(files: SourceFile[]): LivePair[] {
  const groups = new Map<string, { photos: SourceFile[]; videos: SourceFile[] }>()
  for (const f of files) {
    const ext = extOf(f.name)
    const isPhoto = PHOTO_EXT.includes(ext)
    const isVideo = VIDEO_EXT.includes(ext)
    if (!isPhoto && !isVideo) continue
    const k = key(f)
    let g = groups.get(k)
    if (!g) groups.set(k, (g = { photos: [], videos: [] }))
    ;(isPhoto ? g.photos : g.videos).push(f)
  }
  const pairs: LivePair[] = []
  for (const g of groups.values()) {
    if (g.videos.length !== 1 || g.photos.length === 0) continue
    // Si hay HEIC y JPG con el mismo nombre (exportado + original), se empareja con el HEIC.
    const photo = g.photos.find((p) => ['heic', 'heif'].includes(extOf(p.name))) ?? g.photos[0]
    pairs.push({ photo, video: g.videos[0] })
  }
  return pairs
}
