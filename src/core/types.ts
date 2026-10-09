import type { Features } from './analysis/classify'

// Tipos compartidos por el núcleo. El núcleo no conoce el navegador:
// trabaja contra `Target` (el disco) y `SourceFile` (el origen), de modo que
// los tests usan un sistema de archivos en memoria.

export type ProgressFn = (deltaBytes: number) => void

/** Disco de destino. Las rutas son relativas a la carpeta de backup y usan "/". */
export interface Target {
  /** Contenido de texto, o null si no existe. */
  readText(path: string): Promise<string | null>
  /** Reemplaza el archivo completo; no debe dejar un archivo a medias. */
  writeText(path: string, text: string): Promise<void>
  stat(path: string): Promise<{ size: number } | null>
  /** No falla si el archivo no existe. */
  remove(path: string): Promise<void>
  /** Nombres de archivo dentro de `dir` ([] si la carpeta no existe). */
  list(dir: string): Promise<string[]>
  /**
   * Copia `file` a `path` en streaming y devuelve el SHA-256 de lo leído.
   * Si falla, no debe quedar el archivo a medias.
   */
  copyIn(path: string, file: Blob, onProgress: ProgressFn, control: RunControl): Promise<string>
  /** Relee el archivo del disco y devuelve su SHA-256 (null si no existe). */
  hash(path: string, onProgress: ProgressFn, control: RunControl): Promise<string | null>
  /** true si el disco sigue accesible. */
  ping(): Promise<boolean>
  /** Todos los archivos del disco (recursivo), salvo los de control (empiezan por "."). */
  walkFiles(): AsyncIterable<DiskFile>
  /** Contenido del archivo tal cual está en el disco, o null si no existe. */
  readFile(path: string): Promise<Blob | null>
}

export interface DiskFile {
  path: string
  size: number
  lastModified: number
}

/** Caché de hashes del origen, válida mientras no cambien tamaño ni fecha de modificación. */
export interface HashCache {
  get(f: SourceFile): Promise<string | undefined>
  set(f: SourceFile, hash: string): Promise<void>
}

export interface SourceFile {
  /** Ruta relativa dentro de la carpeta de origen; identifica el archivo. */
  relPath: string
  name: string
  size: number
  lastModified: number
  getFile(): Promise<Blob>
  /** Identificador estable para la caché de hashes (origen + ruta). */
  cacheKey?: string
  /** Solo en la plataforma: handle del archivo y de su carpeta (para "Liberar espacio"). */
  handle?: FileSystemFileHandle
  parent?: FileSystemDirectoryHandle
}

export interface Hasher {
  hash(file: Blob, onProgress: ProgressFn, control: RunControl): Promise<string>
}

export interface ExifInfo {
  /** Fecha de captura. */
  date: Date | null
  /** Dimensiones declaradas en el EXIF (para detectar versiones reducidas). */
  width?: number
  height?: number
  /** Fabricante de la cámara (p. ej. "Apple"). */
  make?: string
}

export type ExifReader = (file: Blob) => Promise<ExifInfo>

/** Mide un archivo (bytes, decodificación, vídeo). Lo implementa la plataforma. */
export interface Analyzer {
  analyze(
    file: Blob,
    info: { name: string; ext: string; media: 'image' | 'video'; livePhotoVideo: boolean; exif: ExifInfo },
  ): Promise<Features>
}

export interface RunControl {
  readonly cancelled: boolean
  readonly paused: boolean
  /** Espera mientras esté en pausa; lanza CancelledError si se canceló. */
  checkpoint(): Promise<void>
}

export class CancelledError extends Error {
  name = 'CancelledError'
  constructor() {
    super('Backup cancelado')
  }
}

export class DiskDisconnectedError extends Error {
  name = 'DiskDisconnectedError'
  constructor() {
    super('El disco de destino ya no está accesible')
  }
}

export class DiskFullError extends Error {
  name = 'DiskFullError'
  constructor() {
    super('No queda espacio en el disco de destino')
  }
}

export class ManifestCorruptError extends Error {
  name = 'ManifestCorruptError'
  constructor() {
    super('El manifest y sus copias de seguridad están dañados')
  }
}
