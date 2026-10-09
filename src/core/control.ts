import { CancelledError, type RunControl } from './types'

/** Pausa / reanudar / cancelar compartido entre el motor y la interfaz. */
export class Controller implements RunControl {
  cancelled = false
  paused = false
  private waiters: Array<() => void> = []
  private listeners = new Set<() => void>()

  pause() {
    this.paused = true
    this.emit()
  }

  resume() {
    this.paused = false
    this.wake()
    this.emit()
  }

  cancel() {
    this.cancelled = true
    this.paused = false
    this.wake()
    this.emit()
  }

  async checkpoint() {
    while (this.paused && !this.cancelled) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    if (this.cancelled) throw new CancelledError()
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private wake() {
    const w = this.waiters
    this.waiters = []
    w.forEach((r) => r())
  }

  private emit() {
    this.listeners.forEach((l) => l())
  }
}

/** Control que nunca pausa ni cancela (herramientas y tests). */
export const noControl: RunControl = {
  cancelled: false,
  paused: false,
  checkpoint: async () => {},
}
