// Análisis a nivel de bytes: formato real (magic bytes), final del archivo
// (JPEG/PNG truncados), estructura ISOBMFF (MP4/MOV/HEIC) y Motion Photos.
// Funciones puras sobre una fuente de bytes, para poder probarlas en Node.

export interface ByteSource {
  size: number
  read(offset: number, length: number): Promise<Uint8Array>
}

export function bytesSource(data: Uint8Array): ByteSource {
  return { size: data.byteLength, read: async (o, l) => data.subarray(o, Math.min(o + l, data.byteLength)) }
}

export function blobSource(blob: Blob): ByteSource {
  return { size: blob.size, read: async (o, l) => new Uint8Array(await blob.slice(o, o + l).arrayBuffer()) }
}

export type FormatKind =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'tiff' // también DNG, CR2, NEF, ARW…
  | 'heif'
  | 'avif'
  | 'jxl'
  | 'raw' // RAF, ORF, RW2, CR3
  | 'mp4' // ISOBMFF de vídeo (mp4, m4v, 3gp)
  | 'mov' // QuickTime
  | 'avi'
  | 'mkv' // también WebM
  | 'mpegts'
  | 'mpeg'
  | 'asf' // WMV
  | 'unknown'

export type MediaClass = 'image' | 'video'

export const DECODABLE_IMAGES: FormatKind[] = ['jpeg', 'png', 'gif', 'webp', 'bmp', 'avif']
const ISOBMFF: FormatKind[] = ['heif', 'avif', 'mp4', 'mov', 'raw']

export function isIsobmff(kind: FormatKind) {
  return ISOBMFF.includes(kind)
}

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len))

function startsWith(b: Uint8Array, sig: number[], at = 0) {
  return sig.every((v, i) => b[at + i] === v)
}

const HEIF_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1', 'mif2', 'mif3']
const QT_ATOMS = ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot', 'udta']

/** Formato real a partir de los primeros bytes (al menos 32). */
export function detectFormat(head: Uint8Array): { kind: FormatKind; brand?: string } {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { kind: 'jpeg' }
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'png' }
  if (ascii(head, 0, 4) === 'GIF8') return { kind: 'gif' }
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return { kind: 'webp' }
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'AVI ') return { kind: 'avi' }
  if (ascii(head, 0, 2) === 'BM') return { kind: 'bmp' }
  if (ascii(head, 0, 15) === 'FUJIFILMCCD-RAW') return { kind: 'raw', brand: 'raf' }
  if (startsWith(head, [0x49, 0x49, 0x52, 0x4f]) || startsWith(head, [0x49, 0x49, 0x55, 0x00])) return { kind: 'raw' } // ORF, RW2
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) return { kind: 'tiff' }
  if (startsWith(head, [0xff, 0x0a]) || startsWith(head, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20])) return { kind: 'jxl' }
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'mkv' }
  if (startsWith(head, [0x30, 0x26, 0xb2, 0x75])) return { kind: 'asf' }
  if (startsWith(head, [0, 0, 1, 0xba]) || startsWith(head, [0, 0, 1, 0xb3])) return { kind: 'mpeg' }
  if (head[0] === 0x47 && head[188] === 0x47) return { kind: 'mpegts' }
  if (head[4] === 0x47 && head[196] === 0x47) return { kind: 'mpegts' } // M2TS: 4 bytes de cabecera por paquete

  const box = ascii(head, 4, 4)
  if (box === 'ftyp') {
    const brand = ascii(head, 8, 4)
    // Las marcas compatibles (desde el byte 16) desempatan, p. ej. "mif1" + "heic".
    const compat: string[] = []
    const size = Math.min(readU32(head, 0), head.byteLength)
    for (let i = 16; i + 4 <= size; i += 4) compat.push(ascii(head, i, 4))
    const all = [brand, ...compat]
    if (brand === 'crx ') return { kind: 'raw', brand: 'cr3' }
    if (all.includes('avif') || all.includes('avis')) return { kind: 'avif', brand }
    if (all.some((b) => HEIF_BRANDS.includes(b))) return { kind: 'heif', brand }
    if (brand === 'qt  ') return { kind: 'mov', brand }
    return { kind: 'mp4', brand }
  }
  if (QT_ATOMS.includes(box)) return { kind: 'mov' }
  return { kind: 'unknown' }
}

/** Formatos que siempre tienen una firma reconocible para una extensión. */
const EXPECTED: Record<string, FormatKind[]> = {
  jpg: ['jpeg'], jpeg: ['jpeg'], jpe: ['jpeg'],
  png: ['png'], gif: ['gif'], webp: ['webp'], bmp: ['bmp'],
  heic: ['heif', 'avif'], heif: ['heif', 'avif'], avif: ['avif', 'heif'],
  mp4: ['mp4', 'mov'], m4v: ['mp4', 'mov'], mov: ['mov', 'mp4'], '3gp': ['mp4', 'mov'], '3g2': ['mp4', 'mov'],
  avi: ['avi'], mkv: ['mkv'], webm: ['mkv'], wmv: ['asf'],
}

/**
 * ¿La extensión exige una firma que no aparece? (p. ej. un .jpg que empieza
 * por basura). Si la extensión no está en la lista (RAW poco comunes, etc.)
 * no se puede saber y devuelve false.
 */
export function signatureMissing(ext: string, kind: FormatKind) {
  return kind === 'unknown' && ext in EXPECTED
}

/** Formato real distinto del que indica la extensión (p. ej. un PNG llamado .jpg): no es un error. */
export function extensionMismatch(ext: string, kind: FormatKind) {
  const exp = EXPECTED[ext]
  return !!exp && kind !== 'unknown' && !exp.includes(kind)
}

export function isAllZero(b: Uint8Array) {
  for (let i = 0; i < b.byteLength; i++) if (b[i] !== 0) return false
  return b.byteLength > 0
}

function readU32(b: Uint8Array, o: number) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}

/**
 * JPEG: ¿aparece el marcador final FFD9 en el último tramo del archivo?
 *
 * No se exige que sea lo último: muchos móviles (Samsung, Motion Photos)
 * añaden datos detrás. En los datos comprimidos de un JPEG un FF siempre va
 * seguido de 00 o de un marcador de reinicio, así que un JPEG cortado no
 * contiene FFD9 en su tramo final.
 */
export function jpegHasEnd(tail: Uint8Array) {
  for (let i = tail.byteLength - 1; i > 0; i--) {
    if (tail[i] === 0xd9 && tail[i - 1] === 0xff) return true
  }
  return false
}

/** ¿Hay datos (no relleno) detrás del último FFD9? */
function jpegHasTrailer(tail: Uint8Array) {
  let i = tail.byteLength - 1
  while (i > 0 && (tail[i] === 0x00 || tail[i] === 0xff)) i--
  return !(i >= 1 && tail[i - 1] === 0xff && tail[i] === 0xd9)
}

/** PNG: el último chunk es IEND (admite algo de relleno detrás). */
export function pngHasEnd(tail: Uint8Array) {
  const s = ascii(tail, Math.max(0, tail.byteLength - 64), 64)
  return s.includes('IEND')
}

export interface BoxInfo {
  type: string
  offset: number
  size: number
}

export interface BoxWalk {
  boxes: BoxInfo[]
  /** Un box declara un tamaño que sobrepasa el final del archivo, o la cabecera está cortada. */
  truncated: boolean
  has(type: string): boolean
}

/** Recorre los boxes de primer nivel de un archivo ISOBMFF (MP4/MOV/HEIC). */
export async function walkBoxes(src: ByteSource, maxBoxes = 10_000): Promise<BoxWalk> {
  const boxes: BoxInfo[] = []
  let truncated = false
  let off = 0
  while (off < src.size && boxes.length < maxBoxes) {
    if (src.size - off < 8) {
      // Restos de menos de 8 bytes: solo es aceptable si son ceros (relleno).
      if (!isAllZero(await src.read(off, src.size - off))) truncated = true
      break
    }
    const h = await src.read(off, 16)
    let size = readU32(h, 0)
    const type = ascii(h, 4, 4)
    if (!/^[\x20-\x7e]{4}$/.test(type)) {
      truncated = true
      break
    }
    if (size === 1) {
      if (h.byteLength < 16) {
        truncated = true
        break
      }
      size = readU32(h, 8) * 2 ** 32 + readU32(h, 12)
    } else if (size === 0) {
      size = src.size - off // hasta el final
    }
    if (size < 8) {
      truncated = true
      break
    }
    boxes.push({ type, offset: off, size })
    if (off + size > src.size) {
      truncated = true
      break
    }
    off += size
  }
  return { boxes, truncated, has: (t) => boxes.some((b) => b.type === t) }
}

const MOTION_XMP = /(GCamera:MotionPhoto|GCamera:MicroVideo|Camera:MotionPhoto|MotionPhoto)\s*=\s*["']1["']|<(GCamera|Camera):MotionPhoto>1</

/**
 * Motion Photo (Android): JPEG con un vídeo MP4 incrustado al final. Se
 * reconoce por el XMP de Google/Samsung o por el bloque "MotionPhoto_Data".
 */
export function isMotionPhoto(head: Uint8Array, tail: Uint8Array) {
  const h = new TextDecoder('latin1').decode(head)
  if (MOTION_XMP.test(h)) return true
  const t = new TextDecoder('latin1').decode(tail)
  return t.includes('MotionPhoto_Data') || (jpegHasTrailer(tail) && /ftyp(mp4|isom|mp42|avc1)/.test(t))
}

export interface ByteFeatures {
  kind: FormatKind
  brand?: string
  zeroHeader: boolean
  /** Para JPEG/PNG: ¿tiene el marcador final? */
  hasEnd?: boolean
  motionPhoto?: boolean
  /** Para ISOBMFF. */
  boxes?: { truncated: boolean; types: string[] }
}

const HEAD = 64 * 1024
const TAIL = 64 * 1024
const JPEG_END_WINDOW = 1024 * 1024

/**
 * Posición donde empiezan los datos comprimidos del JPEG (tras la cabecera
 * del primer SOS). Recorre los segmentos APPn, DQT, etc. por su longitud.
 * Devuelve 2 si la estructura no se puede seguir.
 */
export async function jpegScanStart(src: ByteSource) {
  let off = 2
  for (let n = 0; n < 2000 && off + 4 <= src.size; n++) {
    const h = await src.read(off, 4)
    if (h[0] !== 0xff) return 2
    if (h[1] === 0xff) {
      off++ // byte de relleno
      continue
    }
    const marker = h[1]
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      off += 2
      continue
    }
    const len = (h[2] << 8) | h[3]
    if (marker === 0xda) return Math.min(off + 2 + len, src.size)
    if (marker === 0xd9 || len < 2) return 2
    off += 2 + len
  }
  return 2
}

export async function byteFeatures(src: ByteSource): Promise<ByteFeatures> {
  const head = await src.read(0, Math.min(HEAD, src.size))
  const zeroHeader = isAllZero(head.subarray(0, 4096))
  const { kind, brand } = detectFormat(head)
  const out: ByteFeatures = { kind, brand, zeroHeader }
  if (kind === 'png') {
    out.hasEnd = pngHasEnd(await src.read(Math.max(0, src.size - 64), 64))
  }
  if (kind === 'jpeg') {
    // Se busca FFD9 solo en los datos de imagen (tras el primer SOS), para no
    // confundirlo con el final de la miniatura EXIF, y en el último mega.
    const scanStart = Math.max(await jpegScanStart(src), src.size - JPEG_END_WINDOW)
    const region = await src.read(scanStart, src.size - scanStart)
    out.hasEnd = jpegHasEnd(region)
    out.motionPhoto = isMotionPhoto(head, region.subarray(Math.max(0, region.byteLength - TAIL)))
  }
  if (isIsobmff(kind)) {
    const w = await walkBoxes(src)
    out.boxes = { truncated: w.truncated, types: w.boxes.map((b) => b.type) }
  }
  return out
}
