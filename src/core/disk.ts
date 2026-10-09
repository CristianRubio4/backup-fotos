import type { Target } from './types'

export const DISK_ID_FILE = '.backup-disk-id'

export interface DiskInfo {
  id: string
  name: string
  createdAt: string
}

export function newId() {
  return crypto.randomUUID()
}

/** Lee el identificador del disco sin crearlo (null si no lo tiene o no es legible). */
export async function readDiskId(target: Target): Promise<DiskInfo | null> {
  try {
    const d = JSON.parse((await target.readText(DISK_ID_FILE)) ?? 'null')
    return typeof d?.id === 'string' && typeof d?.name === 'string' ? (d as DiskInfo) : null
  } catch {
    return null
  }
}

/** Lee el identificador del disco o lo crea la primera vez. */
export async function ensureDiskId(target: Target, defaultName: string, now = new Date()): Promise<DiskInfo> {
  const text = await target.readText(DISK_ID_FILE)
  if (text !== null) {
    try {
      const d = JSON.parse(text)
      if (typeof d?.id === 'string' && typeof d?.name === 'string') return d as DiskInfo
    } catch {
      // Archivo dañado: se regenera más abajo. El manifest conserva su propio diskId.
    }
  }
  const info: DiskInfo = { id: newId(), name: defaultName, createdAt: now.toISOString() }
  await target.writeText(DISK_ID_FILE, JSON.stringify(info, null, 2))
  return info
}
