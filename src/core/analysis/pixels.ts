// Estadísticas sobre píxeles RGBA (miniaturas). Funciones puras.

export interface PixelStats {
  /** Luminancia media (0-255). */
  mean: number
  /** Mayor desviación típica de los tres canales: ~0 en una imagen de un solo color. */
  std: number
  /** Fracción de píxeles casi iguales al color medio (|Δ| ≤ 12 en todos los canales). */
  uniform: number
}

export function pixelStats(rgba: Uint8ClampedArray | Uint8Array): PixelStats {
  const n = rgba.length / 4
  if (n === 0) return { mean: 0, std: 0, uniform: 1 }
  let r = 0, g = 0, b = 0
  for (let i = 0; i < rgba.length; i += 4) {
    r += rgba[i]
    g += rgba[i + 1]
    b += rgba[i + 2]
  }
  r /= n
  g /= n
  b /= n
  let vr = 0, vg = 0, vb = 0, near = 0
  for (let i = 0; i < rgba.length; i += 4) {
    const dr = rgba[i] - r, dg = rgba[i + 1] - g, db = rgba[i + 2] - b
    vr += dr * dr
    vg += dg * dg
    vb += db * db
    if (Math.abs(dr) <= 12 && Math.abs(dg) <= 12 && Math.abs(db) <= 12) near++
  }
  const std = Math.sqrt(Math.max(vr, vg, vb) / n)
  return { mean: 0.299 * r + 0.587 * g + 0.114 * b, std, uniform: near / n }
}

export function toGray(rgba: Uint8ClampedArray | Uint8Array) {
  const g = new Float32Array(rgba.length / 4)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) g[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  return g
}

/** Varianza del Laplaciano: baja en imágenes borrosas. */
export function laplacianVariance(gray: Float32Array, w: number, h: number) {
  if (w < 3 || h < 3) return 0
  let sum = 0, sum2 = 0, n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const v = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i]
      sum += v
      sum2 += v * v
      n++
    }
  }
  const mean = sum / n
  return sum2 / n - mean * mean
}

export type EmptyKind = 'negra' | 'blanca' | 'de un solo color'

/**
 * ¿Imagen prácticamente de un solo color? Se exigen las dos condiciones
 * (poca variación Y casi todos los píxeles iguales) para no descartar fotos
 * nocturnas o de cielo con pocos detalles.
 */
export function emptyKind(s: PixelStats, maxStd: number): EmptyKind | null {
  if (s.std > maxStd || s.uniform < 0.98) return null
  if (s.mean < 24) return 'negra'
  if (s.mean > 235) return 'blanca'
  return 'de un solo color'
}
