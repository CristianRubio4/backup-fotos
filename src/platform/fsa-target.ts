import { SKIP_DIRS } from '../core/media'
import type { DiskKeys } from '../core/crypto'
import type { DiskFile, ProgressFn, Target } from '../core/types'
import { io } from './io'

const isMissing = (err: unknown) => {
  const name = (err as Error)?.name
  return name === 'NotFoundError' || name === 'TypeMismatchError'
}

function split(path: string) {
  const parts = path.split('/').filter(Boolean)
  return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] }
}

/** Disco de destino real sobre la File System Access API. */
export class FsaTarget implements Target {
  constructor(
    private root: FileSystemDirectoryHandle,
    /** Claves de un disco cifrado desbloqueado (cifra/descifra de forma transparente). */
    readonly keys?: DiskKeys,
  ) {}

  private async dir(parts: string[], create: boolean) {
    let d = this.root
    for (const p of parts) d = await d.getDirectoryHandle(p, { create })
    return d
  }

  private async fileHandle(path: string, create: boolean) {
    const { dirs, name } = split(path)
    return (await this.dir(dirs, create)).getFileHandle(name, { create })
  }

  async readText(path: string) {
    try {
      return await (await (await this.fileHandle(path, false)).getFile()).text()
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
  }

  async writeText(path: string, text: string) {
    const h = await this.fileHandle(path, true)
    // createWritable escribe en un .crswap y reemplaza el original al cerrar.
    const w = await h.createWritable({ keepExistingData: false })
    try {
      await w.write(text)
      await w.close()
    } catch (err) {
      await w.abort().catch(() => {})
      throw err
    }
  }

  async stat(path: string) {
    try {
      return { size: (await (await this.fileHandle(path, false)).getFile()).size }
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
  }

  async remove(path: string) {
    const { dirs, name } = split(path)
    try {
      await (await this.dir(dirs, false)).removeEntry(name)
    } catch (err) {
      if (!isMissing(err)) throw err
    }
  }

  async list(dir: string) {
    try {
      const d = await this.dir(dir.split('/').filter(Boolean), false)
      const names: string[] = []
      for await (const [name, h] of d.entries()) if (h.kind === 'file') names.push(name)
      return names
    } catch (err) {
      if (isMissing(err)) return []
      throw err
    }
  }

  async copyIn(path: string, file: Blob, onProgress: ProgressFn) {
    const existed = (await this.stat(path)) !== null
    // getFileHandle({create:true}) crea ya un archivo vacío: si la copia falla, se elimina.
    const h = await this.fileHandle(path, true)
    try {
      return await io.copy(file, h, onProgress)
    } catch (err) {
      if (!existed) await this.remove(path).catch(() => {})
      throw err
    }
  }

  async hash(path: string, onProgress: ProgressFn) {
    let h: FileSystemFileHandle
    try {
      h = await this.fileHandle(path, false)
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
    return io.hashHandle(h, onProgress)
  }

  async *walkFiles(): AsyncIterable<DiskFile> {
    async function* visit(dir: FileSystemDirectoryHandle, prefix: string): AsyncIterable<DiskFile> {
      for await (const [name, h] of dir.entries()) {
        if (name.startsWith('.')) continue // archivos y carpetas de control (.backup-*, .Trashes…)
        const path = prefix ? `${prefix}/${name}` : name
        if (h.kind === 'directory') {
          if (SKIP_DIRS.has(name.toLowerCase())) continue
          yield* visit(h as FileSystemDirectoryHandle, path)
        } else {
          const f = await (h as FileSystemFileHandle).getFile()
          yield { path, size: f.size, lastModified: f.lastModified }
        }
      }
    }
    yield* visit(this.root, '')
  }

  async readFile(path: string) {
    try {
      return await (await this.fileHandle(path, false)).getFile()
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
  }

  /** Handle de un archivo existente (para leerlo desde el Worker). */
  async existingHandle(path: string) {
    return this.fileHandle(path, false)
  }

  async ping() {
    try {
      if ((await this.root.queryPermission({ mode: 'readwrite' })) !== 'granted') return false
      await this.root.entries().next()
      return true
    } catch {
      return false
    }
  }
}
