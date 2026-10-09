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
