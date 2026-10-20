// EXIF mínimo para los JPG convertidos desde HEIC: fecha de captura, cámara y
// ubicación (lo que usan las apps de fotos para ordenar y mostrar en el mapa).
// Sin orientación: los píxeles ya salen girados al decodificar la HEIC.

export interface ExifData {
  make?: string
  model?: string
  /** Fecha de captura (hora local, como en la foto). */
  taken?: Date | null
  latitude?: number
  longitude?: number
  /** Metros sobre el nivel del mar. */
  altitude?: number
}

const ASCII = 2
const LONG = 4
const RATIONAL = 5
const BYTE = 1

interface Entry {
  tag: number
  type: number
  count: number
  /** Valor ya codificado (little-endian). */
  data: Uint8Array
}

const pad = (n: number) => String(n).padStart(2, '0')

function ascii(s: string): Uint8Array {
  const clean = s.replace(/[^\x20-\x7e]/g, '?')
  const out = new Uint8Array(clean.length + 1)
  for (let i = 0; i < clean.length; i++) out[i] = clean.charCodeAt(i)
  return out
}

function exifDate(d: Date) {
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function rationals(values: Array<[number, number]>): Uint8Array {
  const out = new Uint8Array(values.length * 8)
  const v = new DataView(out.buffer)
  values.forEach(([n, d], i) => {
    v.setUint32(i * 8, n, true)
    v.setUint32(i * 8 + 4, d, true)
  })
  return out
}

/** Grados decimales → grados, minutos y segundos (con milésimas). */
function dms(x: number): Array<[number, number]> {
  const a = Math.abs(x)
  const deg = Math.floor(a)
  const minF = (a - deg) * 60
  const min = Math.floor(minF)
  const sec = Math.round((minF - min) * 60 * 1000)
  return [
    [deg, 1],
    [min, 1],
    [sec, 1000],
  ]
}

function u32(n: number) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n, true)
  return out
}

/** Tamaño de un IFD con sus datos externos (los valores de más de 4 bytes). */
function ifdSize(entries: Entry[]) {
  return 2 + entries.length * 12 + 4 + entries.reduce((a, e) => a + (e.data.length > 4 ? e.data.length + (e.data.length % 2) : 0), 0)
}

/** Escribe un IFD en `buf` a partir de `offset` (relativo al inicio del TIFF). */
function writeIfd(buf: Uint8Array, offset: number, entries: Entry[]) {
  const v = new DataView(buf.buffer, buf.byteOffset)
  const sorted = [...entries].sort((a, b) => a.tag - b.tag)
  v.setUint16(offset, sorted.length, true)
  let data = offset + 2 + sorted.length * 12 + 4
  sorted.forEach((e, i) => {
    const p = offset + 2 + i * 12
    v.setUint16(p, e.tag, true)
    v.setUint16(p + 2, e.type, true)
    v.setUint32(p + 4, e.count, true)
    if (e.data.length <= 4) buf.set(e.data, p + 8)
    else {
      v.setUint32(p + 8, data, true)
      buf.set(e.data, data)
      data += e.data.length + (e.data.length % 2)
    }
  })
  v.setUint32(offset + 2 + sorted.length * 12, 0, true) // no hay IFD siguiente
}

/** Segmento APP1 "Exif" completo (con su marcador), o null si no hay nada que guardar. */
export function buildExifApp1(x: ExifData): Uint8Array<ArrayBuffer> | null {
  const ifd0: Entry[] = []
  const exif: Entry[] = []
  const gps: Entry[] = []
  const text = (tag: number, s: string, list: Entry[]) => {
    const d = ascii(s)
    list.push({ tag, type: ASCII, count: d.length, data: d })
  }
  if (x.make) text(0x010f, x.make, ifd0)
  if (x.model) text(0x0110, x.model, ifd0)
  if (x.taken && !Number.isNaN(x.taken.getTime())) {
    const s = exifDate(x.taken)
    text(0x0132, s, ifd0)
    text(0x9003, s, exif)
    text(0x9004, s, exif)
  }
  if (x.latitude !== undefined && x.longitude !== undefined && Number.isFinite(x.latitude) && Number.isFinite(x.longitude)) {
    gps.push({ tag: 0x0000, type: BYTE, count: 4, data: new Uint8Array([2, 3, 0, 0]) })
    text(0x0001, x.latitude >= 0 ? 'N' : 'S', gps)
    gps.push({ tag: 0x0002, type: RATIONAL, count: 3, data: rationals(dms(x.latitude)) })
    text(0x0003, x.longitude >= 0 ? 'E' : 'W', gps)
    gps.push({ tag: 0x0004, type: RATIONAL, count: 3, data: rationals(dms(x.longitude)) })
    if (x.altitude !== undefined && Number.isFinite(x.altitude)) {
      gps.push({ tag: 0x0005, type: BYTE, count: 1, data: new Uint8Array([x.altitude < 0 ? 1 : 0]) })
      gps.push({ tag: 0x0006, type: RATIONAL, count: 1, data: rationals([[Math.round(Math.abs(x.altitude) * 100), 100]]) })
    }
  }
  if (!ifd0.length && !exif.length && !gps.length) return null

  // Punteros a los IFD de EXIF y GPS (se rellenan cuando se conoce su posición).
  if (exif.length) ifd0.push({ tag: 0x8769, type: LONG, count: 1, data: u32(0) })
  if (gps.length) ifd0.push({ tag: 0x8825, type: LONG, count: 1, data: u32(0) })
  const at0 = 8
  const atExif = at0 + ifdSize(ifd0)
  const atGps = atExif + (exif.length ? ifdSize(exif) : 0)
  for (const e of ifd0) {
    if (e.tag === 0x8769) e.data = u32(atExif)
    if (e.tag === 0x8825) e.data = u32(atGps)
  }
  const tiffLen = atGps + (gps.length ? ifdSize(gps) : 0)

  const tiff = new Uint8Array(tiffLen)
  tiff.set([0x49, 0x49, 0x2a, 0x00]) // "II*\0": little-endian
  new DataView(tiff.buffer).setUint32(4, at0, true)
  writeIfd(tiff, at0, ifd0)
  if (exif.length) writeIfd(tiff, atExif, exif)
  if (gps.length) writeIfd(tiff, atGps, gps)

  const header = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"
  const segLen = 2 + header.length + tiff.length
  if (segLen > 0xffff) return null
  const app1 = new Uint8Array(2 + segLen)
  app1.set([0xff, 0xe1, segLen >> 8, segLen & 0xff])
  app1.set(header, 4)
  app1.set(tiff, 4 + header.length)
  return app1
}

/** Inserta el APP1 justo después del inicio del JPEG (SOI), como pide el estándar EXIF. */
export function insertApp1(jpeg: Uint8Array, app1: Uint8Array): Uint8Array<ArrayBuffer> {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('No es un JPEG')
  const out = new Uint8Array(jpeg.length + app1.length)
  out.set(jpeg.subarray(0, 2))
  out.set(app1, 2)
  out.set(jpeg.subarray(2), 2 + app1.length)
  return out
}
