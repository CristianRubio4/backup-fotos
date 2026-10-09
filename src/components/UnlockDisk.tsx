import type { DiskRecord } from '../db'

/** Desbloqueo de un disco cifrado con su contraseña. */
export function UnlockDisk({ disk }: { disk: DiskRecord }) {
  return <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">"{disk.name}" está cifrado.</p>
}
