export const MANIFEST_FILE = '.backup-manifest.json'
export const MANIFEST_TMP = '.backup-manifest.tmp'
export const MANIFEST_BAK = '.backup-manifest.bak'
export const JOURNAL_DIR = '.backup-journal'

/**
 * verified: hash releído del disco y comparado con el original.
 * unverified: copiado, pero sin comprobar el hash (ver `note`).
 * reduced: posible versión reducida de una foto que está en la nube.
 */
export type EntryStatus = 'verified' | 'unverified' | 'reduced'

export interface ManifestEntry {
  hash: string
  size: number
  originalName: string
  /** Ruta dentro de la carpeta de origen. */
  sourcePath: string
  /** Ruta dentro de la carpeta de backup. */
  diskPath: string
  /** Fecha EXIF en hora local (YYYY-MM-DDTHH:mm:ss), si la hay. */
  exifDate: string | null
  /** Fecha de modificación original del archivo (ISO). */
  fileDate: string
  deviceId: string
  deviceName: string
  status: EntryStatus
  note?: string
  copiedAt: string
}

export interface Manifest {
  version: 1
  diskId: string
  createdAt: string
  updatedAt: string
  entries: ManifestEntry[]
}

export interface JournalSegment {
  version: 1
  seq: number
  entries: ManifestEntry[]
}

const STATUSES: EntryStatus[] = ['verified', 'unverified', 'reduced']

function isStr(v: unknown): v is string {
  return typeof v === 'string'
}

export function isValidEntry(e: unknown): e is ManifestEntry {
  if (!e || typeof e !== 'object') return false
  const o = e as Record<string, unknown>
  return (
    isStr(o.hash) &&
    /^[0-9a-f]{64}$/.test(o.hash) &&
    typeof o.size === 'number' &&
    o.size >= 0 &&
    isStr(o.originalName) &&
    isStr(o.sourcePath) &&
    isStr(o.diskPath) &&
    (o.exifDate === null || isStr(o.exifDate)) &&
    isStr(o.fileDate) &&
    isStr(o.deviceId) &&
    isStr(o.deviceName) &&
    STATUSES.includes(o.status as EntryStatus) &&
    (o.note === undefined || isStr(o.note)) &&
    isStr(o.copiedAt)
  )
}

/** Devuelve el manifest si el texto es un JSON válido y completo; si no, null. */
export function parseManifest(text: string | null): Manifest | null {
  if (text === null) return null
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const m = data as Record<string, unknown>
  if (m.version !== 1 || !isStr(m.diskId) || !isStr(m.createdAt) || !isStr(m.updatedAt)) return null
  if (!Array.isArray(m.entries) || !m.entries.every(isValidEntry)) return null
  return data as Manifest
}

export function parseJournal(text: string | null): JournalSegment | null {
  if (text === null) return null
  try {
    const d = JSON.parse(text)
    if (d?.version !== 1 || typeof d.seq !== 'number' || !Array.isArray(d.entries)) return null
    if (!d.entries.every(isValidEntry)) return null
    return d as JournalSegment
  } catch {
    return null
  }
}
