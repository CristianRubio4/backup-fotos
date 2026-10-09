import { readDiskId } from '../core/disk'
import { FsaTarget } from './fsa-target'

export type DiskStatus =
  | { state: 'none' } // no hay carpeta de backup configurada
  | { state: 'connected'; name: string; id: string | null }
  | { state: 'disconnected' }
  | { state: 'needs-permission' }

/**
 * ¿Está accesible el disco de esta carpeta? Una carpeta de un disco
 * desenchufado sigue guardada, pero leerla falla; al volver a enchufarlo (con
 * la misma letra/ruta) vuelve a funcionar.
 */
export async function checkDisk(handle: FileSystemDirectoryHandle | null): Promise<DiskStatus> {
  if (!handle) return { state: 'none' }
  let perm: PermissionState
  try {
    perm = await handle.queryPermission({ mode: 'readwrite' })
  } catch {
    return { state: 'disconnected' }
  }
  if (perm !== 'granted') return { state: 'needs-permission' }
  const target = new FsaTarget(handle)
  if (!(await target.ping())) return { state: 'disconnected' }
  const info = await readDiskId(target)
  return { state: 'connected', name: info?.name ?? handle.name, id: info?.id ?? null }
}

export const DISK_POLL_MS = 3000
