import type { EncryptionParams } from './crypto'
import type { Target } from './types'

export const DISK_ID_FILE = '.backup-disk-id'

export interface DiskInfo {
  id: string
  name: string
  createdAt: string
  /** Solo en discos cifrados. */
  encryption?: EncryptionParams
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

/** Cambia el nombre guardado en el disco (conserva el identificador). */
export async function renameDisk(target: Target, name: string) {
  const info = await readDiskId(target)
  if (!info) throw new Error('El disco no tiene identificador')
  await target.writeText(DISK_ID_FILE, JSON.stringify({ ...info, name }, null, 2))
}

/** Activa el cifrado en un disco (solo se permite si aún no tiene fotos ni manifest). */
export async function setDiskEncryption(target: Target, encryption: EncryptionParams) {
  const info = await readDiskId(target)
  if (!info) throw new Error('El disco no tiene identificador')
  if (info.encryption) throw new Error('Este disco ya está cifrado')
  await target.writeText(DISK_ID_FILE, JSON.stringify({ ...info, encryption }, null, 2))
}

/** ¿Está el disco vacío (sin manifest ni archivos)? Requisito para activar el cifrado. */
export async function isDiskEmpty(target: Target) {
  if ((await target.readText('.backup-manifest.json')) !== null) return false
  for await (const f of target.walkFiles()) {
    void f
    return false
  }
  return true
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
