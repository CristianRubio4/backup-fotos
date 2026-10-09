import { decryptBytes, encryptBytes, plainSize, type DiskKeys } from '../core/crypto'
import { DISK_ID_FILE } from '../core/disk'
import { SKIP_DIRS } from '../core/media'
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

/**
 * Disco (o carpeta) sobre la File System Access API. Con `keys` (disco
 * cifrado y desbloqueado), todo se cifra al escribir y se descifra al leer,
 * salvo .backup-disk-id, que debe poder leerse sin la contraseña.
 */
export class FsaTarget implements Target {
  constructor(
    private root: FileSystemDirectoryHandle,
    /** Claves de un disco cifrado desbloqueado (cifra/descifra de forma transparente). */
    readonly keys?: DiskKeys,
  ) {}

  private encrypts(path: string) {
    return !!this.keys && path !== DISK_ID_FILE
  }

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
    let file: File
    try {
      file = await (await this.fileHandle(path, false)).getFile()
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
    if (!this.encrypts(path)) return file.text()
    return new TextDecoder().decode(await decryptBytes(this.keys!, new Uint8Array(await file.arrayBuffer())))
  }

  async writeText(path: string, text: string) {
    const h = await this.fileHandle(path, true)
    const data = this.encrypts(path) ? await encryptBytes(this.keys!, new TextEncoder().encode(text)) : text
    // createWritable escribe en un .crswap y reemplaza el original al cerrar.
    const w = await h.createWritable({ keepExistingData: false })
    try {
      await w.write(data as Uint8Array<ArrayBuffer> | string)
      await w.close()
    } catch (err) {
      await w.abort().catch(() => {})
      throw err
    }
  }

  async stat(path: string) {
    try {
      const size = (await (await this.fileHandle(path, false)).getFile()).size
      // En un disco cifrado se informa del tamaño del contenido original.
      return { size: this.encrypts(path) ? plainSize(size) : size }
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
      return this.encrypts(path) ? await io.copyEncrypted(file, h, this.keys!, onProgress) : await io.copy(file, h, onProgress)
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
    return this.encrypts(path) ? io.hashEncrypted(h, this.keys!, onProgress) : io.hashHandle(h, onProgress)
  }

  async *walkFiles(): AsyncIterable<DiskFile> {
    const encrypted = !!this.keys
    async function* visit(dir: FileSystemDirectoryHandle, prefix: string): AsyncIterable<DiskFile> {
      for await (const [name, h] of dir.entries()) {
        if (name.startsWith('.')) continue // archivos y carpetas de control (.backup-*, .Trashes…)
        const path = prefix ? `${prefix}/${name}` : name
        if (h.kind === 'directory') {
          if (SKIP_DIRS.has(name.toLowerCase())) continue
          yield* visit(h as FileSystemDirectoryHandle, path)
        } else {
          const f = await (h as FileSystemFileHandle).getFile()
          yield { path, size: encrypted ? plainSize(f.size) : f.size, lastModified: f.lastModified }
        }
      }
    }
    yield* visit(this.root, '')
  }

  /** Contenido del archivo (descifrado en memoria si el disco está cifrado: úsese para archivos pequeños). */
  async readFile(path: string) {
    let file: File
    try {
      file = await (await this.fileHandle(path, false)).getFile()
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
    if (!this.encrypts(path)) return file
    return new Blob([(await decryptBytes(this.keys!, new Uint8Array(await file.arrayBuffer()))) as Uint8Array<ArrayBuffer>])
  }

  /**
   * Copia un archivo de este disco a otra carpeta (restaurar), en streaming
   * y descifrándolo si el disco está cifrado. Devuelve el SHA-256 del
   * contenido restaurado.
   */
  async exportTo(path: string, dest: FsaTarget, destPath: string, onProgress: ProgressFn) {
    if (!this.encrypts(path)) {
      const src = await this.readFile(path)
      if (!src) throw new DOMException(`No existe ${path}`, 'NotFoundError')
      return dest.copyIn(destPath, src, onProgress)
    }
    const src = await this.fileHandle(path, false)
    const out = await dest.fileHandle(destPath, true)
    try {
      return await io.decryptTo(src, out, this.keys!, onProgress)
    } catch (err) {
      await dest.remove(destPath).catch(() => {})
      throw err
    }
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
