export interface FilterSettings {
  /** Descartar archivos dañados (firma no válida, truncados, no decodificables). */
  corrupt: boolean
  /** Descartar imágenes casi totalmente negras, blancas o de un solo color. */
  empty: boolean
  /** Desviación típica máxima (0-255) para considerar una imagen "de un solo color". */
  emptyMaxStd: number
  /** Descartar imágenes con el lado menor por debajo de `minSide` píxeles. */
  small: boolean
  minSide: number
  /** Descartar imágenes muy borrosas (varianza del Laplaciano). */
  blurry: boolean
  blurThreshold: number
  /** Descartar vídeos más cortos que `minVideoSeconds` (nunca el vídeo de una Live Photo). */
  shortVideo: boolean
  minVideoSeconds: number
  /** Decodificar HEIC con libheif para verificarlas (más lento). */
  heifDecode: boolean
  /** Marcar posibles versiones reducidas (resolución muy inferior a la del EXIF). */
  reduced: boolean
}

export interface Settings {
  /** Releer cada archivo copiado y comparar su hash con el original. */
  verifyHash: boolean
  /** Prefijo de fecha en el nombre: 2026-10-09_143022_IMG_0001.jpg */
  dateInName: boolean
  /** Guardar el progreso (diario del manifest) cada N archivos copiados. */
  saveEvery: number
  /** Todo junto (año/mes) o una subcarpeta por dispositivo (Móvil de Ana/año/mes). */
  layout: 'together' | 'per-device'
  /** Avisar si un disco lleva más de estos días sin backup. */
  staleDays: number
  /** Recordar comprobar la integridad del disco cada estos meses. */
  integrityMonths: number
  filters: FilterSettings
}

export const DEFAULT_FILTERS: FilterSettings = {
  corrupt: true,
  empty: true,
  emptyMaxStd: 4,
  small: true,
  minSide: 200,
  blurry: false,
  blurThreshold: 20,
  shortVideo: false,
  minVideoSeconds: 1,
  heifDecode: true,
  reduced: true,
}

export const DEFAULT_SETTINGS: Settings = {
  verifyHash: true,
  dateInName: true,
  saveEvery: 20,
  layout: 'together',
  staleDays: 30,
  integrityMonths: 6,
  filters: DEFAULT_FILTERS,
}

/** Completa con valores por defecto unos ajustes guardados por una versión anterior. */
export function withDefaults(saved: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...saved, filters: { ...DEFAULT_FILTERS, ...saved?.filters } }
}

export interface Device {
  id: string
  name: string
}
