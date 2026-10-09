export type Phase = 'scan' | 'hash' | 'dedupe' | 'analyze' | 'copy' | 'verify' | 'save'

export const PHASES: Array<{ id: Phase; label: string }> = [
  { id: 'scan', label: 'Escaneando origen' },
  { id: 'hash', label: 'Calculando hashes' },
  { id: 'dedupe', label: 'Comprobando duplicados' },
  { id: 'analyze', label: 'Analizando' },
  { id: 'copy', label: 'Copiando' },
  { id: 'verify', label: 'Verificando' },
  { id: 'save', label: 'Guardando manifest' },
]

export interface Counters {
  copied: number
  duplicates: number
  discarded: number
  unverified: number
  errors: number
}

export interface Progress {
  phase: Phase
  doneBytes: number
  totalBytes: number
  /** Archivos procesados / total en la fase actual. */
  phaseDone: number
  phaseTotal: number
  currentFile: string | null
  counters: Counters
  bytesPerSec: number
  etaSec: number | null
  /** El disco se ha desconectado y el backup espera a que vuelva. */
  waitingDisk: boolean
}

/** Velocidad media de los últimos `windowMs` milisegundos. */
export class SpeedMeter {
  private samples: Array<[number, number]> = []
  constructor(private windowMs = 5000) {}

  sample(t: number, bytes: number) {
    this.samples.push([t, bytes])
    while (this.samples.length > 2 && t - this.samples[0][0] > this.windowMs) this.samples.shift()
  }

  /** Bytes por segundo. */
  rate() {
    if (this.samples.length < 2) return 0
    const [t0, b0] = this.samples[0]
    const [t1, b1] = this.samples[this.samples.length - 1]
    return t1 > t0 ? ((b1 - b0) * 1000) / (t1 - t0) : 0
  }
}
