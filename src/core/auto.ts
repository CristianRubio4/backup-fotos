// Copia automática al conectar el móvil por cable: ¿qué móviles acaban de aparecer?

/** Tiempo mínimo entre dos copias automáticas del mismo móvil (un cable flojo no lanza una copia tras otra). */
export const AUTO_COOLDOWN_MS = 15 * 60_000

export class AutoTrigger {
  private seen: Set<string> | null = null
  private lastRun = new Map<string, number>()

  /**
   * Con los móviles que ve ahora el programa, devuelve los elegidos como origen que
   * acaban de conectarse. La primera comprobación solo registra lo que ya estaba
   * (abrir la app con el móvil ya enchufado no lanza nada).
   */
  check(nowIds: string[], wanted: string[], now = Date.now()): string[] {
    const current = new Set(nowIds)
    const before = this.seen
    this.seen = current
    if (!before) return []
    return wanted.filter((id) => current.has(id) && !before.has(id) && now - (this.lastRun.get(id) ?? -Infinity) >= AUTO_COOLDOWN_MS)
  }

  ran(ids: string[], now = Date.now()) {
    for (const id of ids) this.lastRun.set(id, now)
  }
}