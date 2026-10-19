// Ajustes para los tests: estructura año/mes (rutas predecibles, sin depender
// de la hora del backup). La carpeta por copia tiene sus propios tests.
import { DEFAULT_SETTINGS as APP_DEFAULTS, type Settings } from '../src/core/settings'

export type { Settings }
export const DEFAULT_SETTINGS: Settings = { ...APP_DEFAULTS, runFolder: false }
