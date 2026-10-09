import type { ScanResult } from '../core/backup/engine'
import { isMedia, SKIP_DIRS } from '../core/media'
import type { RunControl, SourceFile } from '../core/types'

/**
 * Recorre la carpeta de origen de forma recursiva. Se salta la carpeta de
 * backup si está dentro del origen (para no copiar el backup en sí mismo) y
 * las carpetas del sistema. Lo que no es foto ni vídeo se devuelve aparte
 * para mostrarlo en el informe.
 */
export async function walkSource(
  root: FileSystemDirectoryHandle,
  exclude: FileSystemDirectoryHandle | null,
  control: RunControl,
  onFound: (count: number) => void,
  /** Con varios orígenes: nombre del origen como primer tramo de la ruta, y clave para la caché de hashes. */
  opts: { label?: string; cacheKeyPrefix?: string; baseCount?: number } = {},
): Promise<ScanResult> {
  const files: SourceFile[] = []
  const ignored: string[] = []
  const base = opts.baseCount ?? 0

  async function visit(dir: FileSystemDirectoryHandle, prefix: string) {
    for await (const [name, handle] of dir.entries()) {
      await control.checkpoint()
      const rel = prefix ? `${prefix}/${name}` : name
      if (handle.kind === 'directory') {
        if (SKIP_DIRS.has(name.toLowerCase())) continue
        const sub = handle as FileSystemDirectoryHandle
        if (exclude && (await sub.isSameEntry(exclude))) continue
        await visit(sub, rel)
        continue
      }
      if (name.startsWith('.') || !isMedia(name)) {
        ignored.push(rel)
        continue
      }
      const fh = handle as FileSystemFileHandle
      const file = await fh.getFile()
      files.push({
        relPath: opts.label ? `${opts.label}/${rel}` : rel,
        name,
        size: file.size,
        lastModified: file.lastModified,
        getFile: () => fh.getFile(),
        cacheKey: opts.cacheKeyPrefix ? `${opts.cacheKeyPrefix}:${rel}` : undefined,
        handle: fh,
        parent: dir,
      })
      if (files.length % 50 === 0) onFound(base + files.length)
    }
  }

  await visit(root, '')
  onFound(base + files.length)
  return { files, ignored: opts.label ? ignored.map((p) => `${opts.label}/${p}`) : ignored }
}

/** ¿Está `inner` dentro de `outer` (o es la misma carpeta)? */
export async function isInside(outer: FileSystemDirectoryHandle, inner: FileSystemDirectoryHandle) {
  if (await outer.isSameEntry(inner)) return true
  return (await outer.resolve(inner)) !== null
}
