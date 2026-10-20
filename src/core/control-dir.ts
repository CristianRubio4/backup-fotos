// Archivos de control de una copia (.backup-disk-id, .backup-manifest.*, .backup-journal/)
// agrupados en una carpeta propia, para que la copia solo muestre fotos y vídeos.

import type { DiskFile, ProgressFn, RunControl, Target } from './types'

export const CONTROL_DIR = '.backup-ignore'

/** ¿Es un archivo o carpeta de control (de primer nivel)? */
const isControl = (path: string) => path.startsWith('.backup-')

/**
 * Destino en el que los archivos de control van dentro de `.backup-ignore/`.
 * Lee también los de la ubicación antigua (sueltos en la carpeta, de versiones
 * anteriores): al guardar, se escriben en la nueva y se quita la antigua.
 */
export function withControlDir(target: Target): Target {
  const inner = (path: string) => (isControl(path) ? `${CONTROL_DIR}/${path}` : path)
  return {
    async readText(path) {
      if (!isControl(path)) return target.readText(path)
      const now = await target.readText(inner(path))
      if (now !== null) return now
      const old = await target.readText(path)
      // Copia de una versión anterior: el archivo de control pasa a .backup-ignore (primero se escribe, luego se quita).
      if (old !== null && !path.startsWith('.backup-journal')) {
        try {
          await target.writeText(inner(path), old)
          await target.remove(path)
        } catch {
          // Disco de solo lectura o similar: se sigue usando donde estaba.
        }
      }
      return old
    },
    async writeText(path, text) {
      await target.writeText(inner(path), text)
      // Migración: la copia antigua suelta ya no hace falta.
      if (isControl(path)) await target.remove(path).catch(() => {})
    },
    async stat(path) {
      if (!isControl(path)) return target.stat(path)
      return (await target.stat(inner(path))) ?? (await target.stat(path))
    },
    async remove(path) {
      await target.remove(inner(path))
      if (isControl(path)) await target.remove(path)
    },
    async list(dir) {
      if (!isControl(dir)) return target.list(dir)
      const [now, old] = await Promise.all([target.list(inner(dir)), target.list(dir)])
      return [...new Set([...now, ...old])]
    },
    copyIn: (path: string, file: Blob, onProgress: ProgressFn, control: RunControl) => target.copyIn(inner(path), file, onProgress, control),
    hash: (path: string, onProgress: ProgressFn, control: RunControl) => target.hash(path, onProgress, control),
    ping: () => target.ping(),
    walkFiles: (accept?: (path: string) => boolean): AsyncIterable<DiskFile> => target.walkFiles(accept),
    readFile: (path: string) => target.readFile(path),
  }
}
