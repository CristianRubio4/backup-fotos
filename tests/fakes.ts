import { hashBlob, hashStream } from '../src/core/hash'
import type { Hasher, ProgressFn, RunControl, SourceFile, Target } from '../src/core/types'

/** Disco en memoria con desconexión y escrituras fallidas simuladas. */
export class MemoryTarget implements Target {
  files = new Map<string, Uint8Array<ArrayBuffer>>()
  disconnected = false
  /** Desconecta el disco cuando se hayan escrito tantos bytes de fotos. */
  disconnectAfterBytes: number | null = null
  /** Corrompe el siguiente archivo copiado (para probar la verificación). */
  corruptNextCopies = 0
  /** Simula FAT32: falla al escribir archivos más grandes que esto. */
  maxFileSize: number | null = null
  /** Rutas en las que se ha intentado copiar. */
  copyAttempts: string[] = []
  private written = 0

  private check() {
    if (this.disconnected) throw new DOMException('Disco desconectado', 'NotFoundError')
  }

  async readText(path: string) {
    this.check()
    const b = this.files.get(path)
    return b ? new TextDecoder().decode(b) : null
  }

  async writeText(path: string, text: string) {
    this.check()
    this.files.set(path, new TextEncoder().encode(text))
  }

  async stat(path: string) {
    this.check()
    const b = this.files.get(path)
    return b ? { size: b.byteLength } : null
  }

  async remove(path: string) {
    this.check()
    this.files.delete(path)
  }

  async list(dir: string) {
    this.check()
    const prefix = dir + '/'
    return [...this.files.keys()]
      .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map((k) => k.slice(prefix.length))
  }

  async copyIn(path: string, file: Blob, onProgress: ProgressFn, control: RunControl) {
    this.check()
    this.copyAttempts.push(path)
    if (this.maxFileSize !== null && file.size > this.maxFileSize) {
      throw new DOMException('El archivo es demasiado grande para el sistema de archivos', 'QuotaExceededError')
    }
    const chunks: Uint8Array<ArrayBuffer>[] = []
    const hash = await hashStream(file.stream(), onProgress, control, {
      write: (chunk) => {
        this.written += chunk.byteLength
        if (this.disconnectAfterBytes !== null && this.written > this.disconnectAfterBytes) {
          this.disconnected = true
        }
        this.check()
        chunks.push(chunk.slice())
      },
    })
    const data = new Uint8Array(chunks.reduce((a, c) => a + c.byteLength, 0))
    let off = 0
    for (const c of chunks) {
      data.set(c, off)
      off += c.byteLength
    }
    if (this.corruptNextCopies > 0 && data.byteLength > 0) {
      this.corruptNextCopies--
      data[0] ^= 0xff
    }
    // Como createWritable(): el archivo solo aparece al terminar bien.
    this.files.set(path, data)
    return hash
  }

  async hash(path: string, onProgress: ProgressFn, control: RunControl) {
    this.check()
    const b = this.files.get(path)
    return b ? hashBlob(new Blob([b]), onProgress, control) : null
  }

  async ping() {
    return !this.disconnected
  }

  async *walkFiles() {
    this.check()
    for (const [path, b] of [...this.files].sort(([a], [b]) => a.localeCompare(b))) {
      if (path.split('/').some((seg) => seg.startsWith('.'))) continue
      yield { path, size: b.byteLength, lastModified: 0 }
    }
  }

  async readFile(path: string) {
    this.check()
    const b = this.files.get(path)
    return b ? new Blob([b]) : null
  }

  mediaPaths() {
    return [...this.files.keys()].filter((k) => !k.startsWith('.')).sort()
  }
}

export const testHasher: Hasher = { hash: hashBlob }

export function src(relPath: string, content: string | Uint8Array<ArrayBuffer>, lastModified = new Date(2024, 4, 17, 10, 30, 0).getTime()): SourceFile {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  const name = relPath.split('/').pop()!
  return {
    relPath,
    name,
    size: bytes.byteLength,
    lastModified,
    getFile: async () => new Blob([bytes]),
  }
}
