// Extensiones que se consideran fotos o vídeos. Lo demás se ignora y se
// cuenta en el informe (nunca se descarta en silencio).

const IMAGE = [
  'jpg', 'jpeg', 'jpe', 'png', 'heic', 'heif', 'avif', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'jxl',
  'dng', 'raw', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f', '3fr', 'iiq',
]
const VIDEO = ['mp4', 'mov', 'm4v', '3gp', '3g2', 'avi', 'mkv', 'webm', 'mts', 'm2ts', 'mpg', 'mpeg', 'wmv', 'insv', 'lrv']

const MEDIA = new Set([...IMAGE, ...VIDEO])
const VIDEO_SET = new Set(VIDEO)

export function extOf(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isMedia(name: string) {
  return MEDIA.has(extOf(name))
}

export function isVideo(name: string) {
  return VIDEO_SET.has(extOf(name))
}

/** Carpetas del sistema que nunca contienen fotos del usuario. */
export const SKIP_DIRS = new Set([
  '$recycle.bin', 'system volume information', '.trashes', '.spotlight-v100', '.fseventsd', '.thumbnails', '.trash',
])
