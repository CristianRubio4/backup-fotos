import type { ScanResult } from '../core/backup/engine'
import { friendlyError } from '../core/errors'
import { isMedia, skipDir } from '../core/media'
import { CancelledError, type RunControl, type SourceFile } from '../core/types'

/**
 * Recorre la carpeta de origen de forma recursiva. Se salta la carpeta de
 * backup si está dentro del origen (para no copiar el backup en sí mismo),
 * las carpetas del sistema y las ocultas. Lo que no es foto ni vídeo se
 * devuelve aparte para mostrarlo en el informe.
 *
 * Un archivo o subcarpeta que no se puede leer (en un móvil es habitual:
 * miniaturas, papelera o fotos "pendientes" que aparecen y desaparecen
 * mientras se recorre) se anota en `unreadable` y el recorrido continúa: un
 * archivo problemático nunca detiene el backup del resto.
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
  const unreadable: NonNullable<ScanResult['unreadable']> = []
  const base = opts.baseCount ?? 0
  const label = (rel: string) => (opts.label ? (rel ? `${opts.label}/${rel}` : opts.label) : rel)

  const rethrowCancel = (err: unknown) => {
    if (err instanceof CancelledError || (err as Error)?.name === 'CancelledError') throw err
  }

  async function visit(dir: FileSystemDirectoryHandle, prefix: string) {
    // El iterador puede fallar a mitad (carpeta desaparecida): lo ya visto se conserva.
    try {
      for await (const [name, handle] of dir.entries()) {
        await control.checkpoint()
        const rel = prefix ? `${prefix}/${name}` : name
        if (handle.kind === 'directory') {
          // Carpetas del sistema y ocultas (.thumbnails, .trashed, .pending…): nunca contienen fotos del usuario.
          if (skipDir(name, rel)) continue
          const sub = handle as FileSystemDirectoryHandle
          try {
            if (exclude && (await sub.isSameEntry(exclude))) continue
          } catch {
            // Si no se puede comparar, se recorre igualmente.
          }
          await visit(sub, rel)
          continue
        }
        if (name.startsWith('.') || !isMedia(name)) {
          ignored.push(rel)
          continue
        }
        const fh = handle as FileSystemFileHandle
        try {
          const file = await fh.getFile()
          files.push({
            relPath: label(rel),
            name,
            size: file.size,
            lastModified: file.lastModified,
            getFile: () => fh.getFile(),
            cacheKey: opts.cacheKeyPrefix ? `${opts.cacheKeyPrefix}:${rel}` : undefined,
            handle: fh,
            parent: dir,
          })
        } catch (err) {
          rethrowCancel(err)
          unreadable.push({ relPath: label(rel), reason: friendlyError(err) })
        }
        if (files.length % 50 === 0) onFound(base + files.length)
      }
    } catch (err) {
      rethrowCancel(err)
      if (!prefix) throw err // la carpeta de origen entera no se puede leer: lo decide quien llama
      unreadable.push({ relPath: label(prefix), reason: `Carpeta no legible: ${friendlyError(err)}` })
    }
  }

  await visit(root, '')
  onFound(base + files.length)
  return { files, ignored: ignored.map(label), unreadable }
}

/**
 * ¿Se puede leer la carpeta ahora mismo? Devuelve null si sí, o el motivo si
 * no (p. ej. el móvil se ha desconectado o la carpeta ya no existe).
 */
export async function checkReadable(dir: FileSystemDirectoryHandle): Promise<string | null> {
  try {
    await dir.entries().next()
    return null
  } catch (err) {
    return friendlyError(err)
  }
}

/** ¿Está `inner` dentro de `outer` (o es la misma carpeta)? */
export async function isInside(outer: FileSystemDirectoryHandle, inner: FileSystemDirectoryHandle) {
  try {
    if (await outer.isSameEntry(inner)) return true
    return (await outer.resolve(inner)) !== null
  } catch {
    return false
  }
}
