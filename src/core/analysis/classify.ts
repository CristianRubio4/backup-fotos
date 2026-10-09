import type { FilterSettings } from '../settings'
import { DECODABLE_IMAGES, isIsobmff, signatureMissing, type ByteFeatures } from './formats'
import { emptyKind, type PixelStats } from './pixels'

/** Todo lo que se ha podido medir de un archivo. Lo que falta es "no comprobado". */
export interface Features {
  ext: string
  size: number
  media: 'image' | 'video'
  bytes: ByteFeatures
  /** Decodificación de la imagen (navegador o libheif). undefined = no se intentó. */
  decode?: { ok: true; width: number; height: number; stats: PixelStats; blur?: number; via: 'browser' | 'libheif' } | { ok: false; error: string; via: 'browser' | 'libheif' }
  /** libheif no se pudo cargar en este navegador. */
  heifUnavailable?: boolean
  /** Metadatos de vídeo cargados en un <video>. undefined = no se intentó. */
  video?: { ok: true; duration: number; width: number; height: number } | { ok: false; error: string }
  /** Dimensiones declaradas en el EXIF. */
  exifSize?: { width: number; height: number }
  /** Es el vídeo de una Live Photo (no se le aplica el filtro de duración). */
  livePhotoVideo?: boolean
}

export type DiscardCategory = 'corrupt' | 'empty' | 'small' | 'blurry' | 'short'

export type Verdict =
  | { action: 'copy'; status: 'ok' }
  | { action: 'copy'; status: 'unverified' | 'reduced'; note: string }
  | { action: 'discard'; category: DiscardCategory; reason: string }

const ok: Verdict = { action: 'copy', status: 'ok' }
const unverified = (note: string): Verdict => ({ action: 'copy', status: 'unverified', note })
const discard = (category: DiscardCategory, reason: string): Verdict => ({ action: 'discard', category, reason })

/**
 * Decide qué hacer con un archivo. Principio: solo se descarta lo que se ha
 * comprobado que no sirve; lo que no se puede comprobar se copia como
 * "no verificado".
 */
export function classify(f: Features, s: FilterSettings): Verdict {
  const b = f.bytes
  if (f.size === 0) return s.corrupt ? discard('corrupt', 'Archivo vacío (0 bytes)') : unverified('Archivo vacío (0 bytes)')

  // ---- Estructura (bytes) ----
  const broken = structuralProblem(f)
  if (broken) {
    if (broken.certain && s.corrupt) return discard('corrupt', broken.reason)
    return unverified(broken.reason)
  }

  if (f.media === 'video' || ['mp4', 'mov', 'avi', 'mkv', 'mpegts', 'mpeg', 'asf'].includes(b.kind)) return classifyVideo(f, s)
  return classifyImage(f, s)
}

function structuralProblem(f: Features): { reason: string; certain: boolean } | null {
  const b = f.bytes
  if (b.zeroHeader) return { reason: 'El contenido está vacío (todo ceros): el archivo está dañado', certain: true }
  if (signatureMissing(f.ext, b.kind)) {
    return { reason: `No es un .${f.ext} válido: su cabecera no corresponde a ningún formato conocido`, certain: true }
  }
  if (b.kind === 'jpeg' && b.hasEnd === false && !b.motionPhoto) return { reason: 'JPEG incompleto (truncado): falta el final del archivo', certain: true }
  if (b.kind === 'png' && b.hasEnd === false) return { reason: 'PNG incompleto (truncado): falta el bloque final IEND', certain: true }
  if (isIsobmff(b.kind) && b.boxes) {
    const isHeif = b.kind === 'heif' || b.kind === 'avif'
    // Una HEIC con la estructura dañada solo se descarta si libheif tampoco la abre.
    const heifConfirmed = isHeif && f.decode?.ok === false && f.decode.via === 'libheif'
    if (b.boxes.truncated) {
      return { reason: isHeif ? 'HEIC incompleta (truncada)' : 'Vídeo incompleto (truncado): el archivo está cortado', certain: !isHeif || heifConfirmed }
    }
    if ((b.kind === 'mp4' || b.kind === 'mov') && !b.boxes.types.includes('moov')) {
      return { reason: 'Vídeo sin índice (falta el bloque "moov"): no se puede reproducir', certain: true }
    }
    if (isHeif && !b.boxes.types.includes('meta')) return { reason: 'HEIC sin bloque "meta"', certain: heifConfirmed }
  }
  return null
}

function classifyImage(f: Features, s: FilterSettings): Verdict {
  const b = f.bytes
  const d = f.decode
  const browserDecodable = DECODABLE_IMAGES.includes(b.kind)

  if (!d) {
    if (b.kind === 'heif') {
      return unverified(f.heifUnavailable ? 'HEIC: solo se ha comprobado la estructura (el decodificador no está disponible)' : 'HEIC: solo se ha comprobado la estructura')
    }
    if (browserDecodable) return unverified('No se ha podido analizar la imagen')
    return unverified(`Formato ${b.kind === 'unknown' ? `.${f.ext}` : b.kind.toUpperCase()}: el navegador no puede abrirlo; solo se ha comprobado la cabecera`)
  }

  if (!d.ok) {
    // El navegador decodifica JPEG/PNG/GIF/WebP/BMP/AVIF: si falla, el archivo está dañado.
    if (d.via === 'browser' && browserDecodable && s.corrupt) return discard('corrupt', `No se puede abrir la imagen (${d.error})`)
    return unverified(`No se ha podido decodificar (${d.error})`)
  }

  if (s.empty) {
    const empty = emptyKind(d.stats, s.emptyMaxStd)
    if (empty) return discard('empty', `Imagen ${empty}`)
  }
  const minSide = Math.min(d.width, d.height)
  if (s.small && minSide < s.minSide) return discard('small', `Imagen demasiado pequeña (${d.width}×${d.height} px)`)
  if (s.blurry && d.blur !== undefined && d.blur < s.blurThreshold) {
    return discard('blurry', `Imagen muy borrosa (nitidez ${d.blur.toFixed(1)} < ${s.blurThreshold})`)
  }

  if (s.reduced && f.exifSize) {
    const exifMax = Math.max(f.exifSize.width, f.exifSize.height)
    const realMax = Math.max(d.width, d.height)
    if (exifMax >= 1.5 * realMax && exifMax >= 1000) {
      return {
        action: 'copy',
        status: 'reduced',
        note: `Posible versión reducida: ${d.width}×${d.height} px, pero el EXIF indica ${f.exifSize.width}×${f.exifSize.height}. Puede que el original esté solo en la nube.`,
      }
    }
  }

  return ok
}

function classifyVideo(f: Features, s: FilterSettings): Verdict {
  const v = f.video
  if (!v) return unverified('No se ha podido analizar el vídeo')
  if (!v.ok) {
    // La estructura es correcta (se comprobó antes): probablemente un códec que el navegador no reproduce (HEVC…).
    return unverified(`El navegador no puede reproducir este vídeo (${v.error}); su estructura es correcta`)
  }
  if (!(v.duration > 0)) {
    return s.corrupt ? discard('corrupt', 'Vídeo sin duración (0 s)') : unverified('Vídeo sin duración (0 s)')
  }
  if (s.shortVideo && !f.livePhotoVideo && Number.isFinite(v.duration) && v.duration < s.minVideoSeconds) {
    return discard('short', `Vídeo demasiado corto (${v.duration.toFixed(1)} s)`)
  }
  return ok
}
