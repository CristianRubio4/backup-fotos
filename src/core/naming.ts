// Carpetas año/mes y nombres de archivo con fecha.

export const NO_DATE_DIR = 'Sin fecha'

const MIN_RELIABLE = new Date(1990, 0, 1).getTime()

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Fecha local en formato YYYY-MM-DDTHH:mm:ss (sin zona, como el EXIF). */
export function toLocalIso(d: Date) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

function isValidDate(d: Date | null | undefined): d is Date {
  return !!d && !Number.isNaN(d.getTime())
}

export type DateSource = 'exif' | 'file' | 'none'

/**
 * Fecha para organizar el archivo: EXIF si existe; si no, la de modificación
 * cuando es razonable (posterior a 1990 y no futura); si no, ninguna.
 */
export function pickDate(exif: Date | null, lastModified: number, now = new Date()) {
  if (isValidDate(exif) && exif.getTime() >= MIN_RELIABLE) {
    return { date: exif, source: 'exif' as DateSource }
  }
  const tomorrow = now.getTime() + 24 * 3600 * 1000
  if (lastModified >= MIN_RELIABLE && lastModified <= tomorrow) {
    return { date: new Date(lastModified), source: 'file' as DateSource }
  }
  return { date: null, source: 'none' as DateSource }
}

export function folderFor(date: Date | null) {
  return date ? `${date.getFullYear()}/${pad(date.getMonth() + 1)}` : NO_DATE_DIR
}

/**
 * Carpeta de cada backup: "iPhone 15 Pro - 2026-10-19 14h30" con el nombre del
 * móvil, o "Copia 2026-10-19 14h30" si no se sabe (sin ":", que Windows no admite).
 */
export function runFolderName(d: Date, label?: string | null) {
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}h${pad(d.getMinutes())}`
  const name = label ? sanitizeName(label).trim() : ''
  return name ? `${name} - ${stamp}` : `Copia ${stamp}`
}

/** Nombre legible de la cámara: Apple + "iPhone 15 Pro" → "iPhone 15 Pro"; samsung + "SM-S911B" → "Samsung SM-S911B". */
export function cameraName(make?: string, model?: string) {
  const mk = make?.replace(/\s+/g, ' ').trim() ?? ''
  const md = model?.replace(/\s+/g, ' ').trim() ?? ''
  if (!md) return mk ? mk.charAt(0).toUpperCase() + mk.slice(1) : null
  if (!mk || /^apple$/i.test(mk) || md.toLowerCase().startsWith(mk.toLowerCase().split(' ')[0])) return md
  return `${mk.charAt(0).toUpperCase()}${mk.slice(1)} ${md}`
}

/**
 * El móvil o cámara del que vienen la mayoría de las fotos (según el EXIF), o
 * null si no hay ninguno claro (fotos sin EXIF, de muchos dispositivos…).
 */
export function dominantCamera(exifs: Array<{ make?: string; model?: string }>) {
  const counts = new Map<string, number>()
  let withCamera = 0
  for (const e of exifs) {
    const n = cameraName(e.make, e.model)
    if (!n) continue
    withCamera++
    counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  let best: string | null = null
  let max = 0
  for (const [n, c] of counts) if (c > max) [best, max] = [n, c]
  return best && max * 2 >= withCamera ? best : null
}

/**
 * Carpeta de destino de un archivo:
 *  - con carpeta por copia: "Copia 2026-10-19 14h30/" (+ dispositivo),
 *  - si no: año/mes (con el dispositivo delante si se separan).
 */
export function targetDir(opts: { runFolder: string | null; device: string | null; date: Date | null }) {
  const device = opts.device ? sanitizeName(opts.device) : null
  if (opts.runFolder) return device ? `${opts.runFolder}/${device}` : opts.runFolder
  return (device ? `${device}/` : '') + folderFor(opts.date)
}

/**
 * Quita caracteres no válidos en Windows / FAT / exFAT y los puntos o
 * espacios finales, que Windows no admite.
 */
export function sanitizeName(name: string) {
  let s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '')
  if (!s || s === '.' || s === '..') s = 'archivo'
  return s
}

const DATED_RE = /^\d{4}-\d{2}-\d{2}_\d{6}_/

/** 2026-10-09_143022_IMG_0001.jpg (si el nombre ya trae ese prefijo, no se repite). */
export function datedName(name: string, date: Date | null, enabled: boolean) {
  const clean = sanitizeName(name)
  if (!enabled || !date || DATED_RE.test(clean)) return clean
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${stamp}_${clean}`
}

/** IMG.jpg → IMG_1.jpg, IMG_2.jpg… */
export function withSuffix(name: string, n: number) {
  if (n === 0) return name
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)}_${n}${name.slice(dot)}` : `${name}_${n}`
}
