// Decodificación y medidas de imágenes dentro del Worker.
import type { Features } from '../core/analysis/classify'
import { laplacianVariance, pixelStats, toGray } from '../core/analysis/pixels'

type Decode = NonNullable<Features['decode']>

const STATS_SIZE = 64
const BLUR_SIZE = 512

function errText(err: unknown) {
  return (err as Error)?.message || String(err)
}

/** Estadísticas sobre una miniatura y nitidez sobre una versión de 512 px. */
function measure(source: CanvasImageSource, width: number, height: number, wantBlur: boolean) {
  const small = new OffscreenCanvas(STATS_SIZE, STATS_SIZE)
  const sctx = small.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(source, 0, 0, STATS_SIZE, STATS_SIZE)
  const stats = pixelStats(sctx.getImageData(0, 0, STATS_SIZE, STATS_SIZE).data)

  let blur: number | undefined
  if (wantBlur) {
    const k = Math.min(1, BLUR_SIZE / Math.max(width, height))
    const w = Math.max(3, Math.round(width * k))
    const h = Math.max(3, Math.round(height * k))
    const c = new OffscreenCanvas(w, h)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(source, 0, 0, w, h)
    blur = laplacianVariance(toGray(ctx.getImageData(0, 0, w, h).data), w, h)
  }
  return { stats, blur }
}

/** JPEG, PNG, GIF, WebP, BMP, AVIF: los decodifica el propio navegador. */
export async function decodeWithBrowser(file: Blob, wantBlur: boolean): Promise<Decode> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch (err) {
    return { ok: false, error: errText(err), via: 'browser' }
  }
  try {
    const { width, height } = bmp
    if (!width || !height) return { ok: false, error: 'dimensiones 0', via: 'browser' }
    return { ok: true, width, height, ...measure(bmp, width, height, wantBlur), via: 'browser' }
  } finally {
    bmp.close()
  }
}

type LibHeif = ReturnType<typeof import('libheif-js/libheif-wasm/libheif-bundle.mjs').default>
let heif: Promise<LibHeif> | null = null

/** libheif (~2 MB) se carga solo la primera vez que aparece una HEIC. */
function loadHeif() {
  heif ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => m.default())
  return heif
}

/** Miniatura JPEG de una HEIC (para explorar el backup), o null si no se puede decodificar. */
export async function heicThumbnail(file: Blob, size: number): Promise<Blob | null> {
  let lib: LibHeif
  try {
    lib = await loadHeif()
  } catch {
    heif = null
    return null
  }
  let images: ReturnType<InstanceType<LibHeif['HeifDecoder']>['decode']> = []
  try {
    images = new lib.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()))
    const img = images[0]
    if (!img) return null
    const width = img.get_width()
    const height = img.get_height()
    const data = new ImageData(width, height)
    await new Promise<void>((resolve, reject) => img.display(data, (r) => (r ? resolve() : reject(new Error('no se pudo decodificar')))))
    const full = new OffscreenCanvas(width, height)
    full.getContext('2d')!.putImageData(data, 0, 0)
    const k = Math.min(1, size / Math.max(width, height))
    const thumb = new OffscreenCanvas(Math.round(width * k), Math.round(height * k))
    thumb.getContext('2d')!.drawImage(full, 0, 0, thumb.width, thumb.height)
    return await thumb.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  } catch {
    return null
  } finally {
    images.forEach((i) => i.free?.())
  }
}

/** HEIC/HEIF: el navegador no las abre; se decodifican con libheif (WebAssembly). */
export async function decodeHeif(file: Blob, wantBlur: boolean): Promise<Decode | 'unavailable'> {
  let lib: LibHeif
  try {
    lib = await loadHeif()
  } catch {
    heif = null
    return 'unavailable'
  }
  let images: ReturnType<InstanceType<LibHeif['HeifDecoder']>['decode']> = []
  try {
    images = new lib.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()))
    if (!images.length) return { ok: false, error: 'no contiene ninguna imagen', via: 'libheif' }
    const img = images[0]
    const width = img.get_width()
    const height = img.get_height()
    const data = new ImageData(width, height)
    await new Promise<void>((resolve, reject) => img.display(data, (r) => (r ? resolve() : reject(new Error('no se pudo decodificar')))))
    const canvas = new OffscreenCanvas(width, height)
    canvas.getContext('2d')!.putImageData(data, 0, 0)
    return { ok: true, width, height, ...measure(canvas, width, height, wantBlur), via: 'libheif' }
  } catch (err) {
    return { ok: false, error: errText(err), via: 'libheif' }
  } finally {
    images.forEach((i) => i.free?.())
  }
}
