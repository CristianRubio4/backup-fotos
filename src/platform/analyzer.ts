import type { Features } from '../core/analysis/classify'
import { isIsobmff } from '../core/analysis/formats'
import type { FilterSettings } from '../core/settings'
import type { Analyzer } from '../core/types'
import { io } from './io'

type VideoResult = NonNullable<Features['video']>

const MEDIA_ERRORS: Record<number, string> = {
  1: 'carga cancelada',
  2: 'error de red',
  3: 'error al decodificar',
  4: 'formato o códec no soportado',
}

/**
 * Carga los metadatos del vídeo en un <video> (solo existe en el hilo
 * principal). Si la duración llega como Infinity (MP4 fragmentados), se
 * fuerza a calcularla saltando al final.
 */
export function probeVideo(file: Blob, timeoutMs = 15_000): Promise<VideoResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    let done = false
    const finish = (r: VideoResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      v.removeAttribute('src')
      v.load()
      URL.revokeObjectURL(url)
      resolve(r)
    }
    const timer = setTimeout(() => finish({ ok: false, error: 'tiempo de espera agotado' }), timeoutMs)
    const report = () => finish({ ok: true, duration: v.duration, width: v.videoWidth, height: v.videoHeight })
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration)) return report()
      v.ondurationchange = () => Number.isFinite(v.duration) && report()
      v.currentTime = 1e9
      setTimeout(report, 3000) // si no llega, se informa Infinity (vale como "> 0")
    }
    v.onerror = () => finish({ ok: false, error: MEDIA_ERRORS[v.error?.code ?? 0] ?? 'error desconocido' })
    v.src = url
  })
}

export function createAnalyzer(filters: FilterSettings): Analyzer {
  return {
    async analyze(file, info) {
      const measured = await io.inspect(file, { media: info.media, heifDecode: filters.heifDecode, wantBlur: filters.blurry })
      const f: Features = {
        ext: info.ext,
        size: file.size,
        media: info.media,
        livePhotoVideo: info.livePhotoVideo,
        exifSize: info.exif.width && info.exif.height ? { width: info.exif.width, height: info.exif.height } : undefined,
        ...measured,
      }
      const b = measured.bytes
      // El vídeo solo se carga si su estructura es correcta (si no, ya se descarta por los bytes).
      const structureOk = !b.zeroHeader && b.kind !== 'unknown' && !(isIsobmff(b.kind) && b.boxes?.truncated)
      if (info.media === 'video' && structureOk) f.video = await probeVideo(file)
      return f
    },
  }
}
