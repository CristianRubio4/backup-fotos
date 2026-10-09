export interface Settings {
  /** Releer cada archivo copiado y comparar su hash con el original. */
  verifyHash: boolean
  /** Prefijo de fecha en el nombre: 2026-10-09_143022_IMG_0001.jpg */
  dateInName: boolean
  /** Guardar el progreso (diario del manifest) cada N archivos copiados. */
  saveEvery: number
}

export const DEFAULT_SETTINGS: Settings = {
  verifyHash: true,
  dateInName: true,
  saveEvery: 20,
}

export interface Device {
  id: string
  name: string
}
