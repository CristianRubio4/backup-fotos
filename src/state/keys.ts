import type { DiskKeys } from '../core/crypto'
import { FsaTarget } from '../platform/fsa-target'

/**
 * Claves de los discos cifrados desbloqueados en esta sesión. Solo viven en
 * memoria: al cerrar o recargar la página hay que volver a escribir la
 * contraseña.
 */
const keys = new Map<string, DiskKeys>()

export function setDiskKeys(diskId: string, k: DiskKeys) {
  keys.set(diskId, k)
}

export function forgetDiskKeys(diskId: string) {
  keys.delete(diskId)
}

export function getDiskKeys(diskId: string | null) {
  return diskId ? keys.get(diskId) : undefined
}

export function isLocked(d: { diskId: string | null }) {
  return !d.diskId || !keys.has(d.diskId)
}

/** Disco como Target; si está cifrado y desbloqueado, cifra y descifra de forma transparente. */
export function diskTarget(d: { handle: FileSystemDirectoryHandle; diskId: string | null }) {
  return new FsaTarget(d.handle, getDiskKeys(d.diskId))
}
