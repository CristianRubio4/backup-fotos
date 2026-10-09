// Modo compatible (Safari/iPhone, Firefox): sin acceso de escritura al disco.
// Se analizan y deduplican las fotos igual que en el modo completo y se
// preparan lotes ZIP que el usuario guarda en el disco a mano.

import { classify, type DiscardCategory, type Verdict } from '../analysis/classify'
import { findLivePhotos } from '../analysis/pairing'
import type { ReportItem } from '../backup/engine'
import type { ManifestEntry } from '../manifest/schema'
import { extOf, isVideo } from '../media'
import { datedName, folderFor, pickDate, sanitizeName, toLocalIso, withSuffix } from '../naming'
import type { Device, Settings } from '../settings'
import { CancelledError, type Analyzer, type ExifInfo, type ExifReader, type Hasher, type RunControl, type SourceFile } from '../types'

export interface CompatItem {
  file: SourceFile
  hash: string
  /** Ruta dentro del ZIP (la misma estructura que en el disco: año/mes/nombre con fecha). */
  zipPath: string
  entry: ManifestEntry
  /** Para mantener juntas las Live Photos en el mismo lote. */
  pairKey?: string
}

export interface CompatPlan {
  items: CompatItem[]
  duplicates: ReportItem[]
  discarded: ReportItem[]
  unverified: ReportItem[]
  reduced: ReportItem[]
  errors: ReportItem[]
  livePhotos: number
  motionPhotos: number
  /** Posibles conversiones HEIC→JPEG hechas por Safari al elegir las fotos. */
  convertedByIOS: string[]
  /** Fotos de iPhone sin vídeo de Live Photo emparejado (Safari no lo entrega). */
  appleWithoutVideo: number
}

const item = (f: SourceFile, extra: Partial<ReportItem> = {}): ReportItem => ({ name: f.name, sourcePath: f.relPath, size: f.size, ...extra })

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

export async function planCompat(opts: {
  files: SourceFile[]
  /** ¿Ya está guardado (historial de ZIP o manifest del disco aportado)? */
  isKnown: (hash: string) => boolean
  hasher: Hasher
  readExif: ExifReader
  analyzer?: Analyzer
  settings: Settings
  device: Device
  control: RunControl
  force?: Set<string>
  /** El navegador es Safari en iPhone/iPad (para avisar de conversiones y Live Photos). */
  isIOS?: boolean
  onProgress?: (p: { phase: 'hash' | 'analyze'; done: number; total: number; current: string | null; bytes: number }) => void
  now?: () => Date
}): Promise<CompatPlan> {
  const { settings, device, control } = opts
  const force = opts.force ?? new Set<string>()
  const now = opts.now ?? (() => new Date())
  const plan: CompatPlan = { items: [], duplicates: [], discarded: [], unverified: [], reduced: [], errors: [], livePhotos: 0, motionPhotos: 0, convertedByIOS: [], appleWithoutVideo: 0 }

  const files = opts.files.filter((f) => {
    if (f.size === 0 && settings.filters.corrupt && !force.has(f.relPath)) {
      plan.discarded.push(item(f, { category: 'corrupt', reason: 'Archivo vacío (0 bytes)' }))
      return false
    }
    return true
  })
  const pairs = findLivePhotos(files)
  plan.livePhotos = pairs.length
  const photoOfVideo = new Map(pairs.map((p) => [p.video, p.photo]))

  // ---- Hashes (todos: sin disco no hay otra forma de saber qué está guardado) ----
  const hashes = new Map<SourceFile, string>()
  let bytes = 0
  for (let i = 0; i < files.length; i++) {
    await control.checkpoint()
    const f = files[i]
    opts.onProgress?.({ phase: 'hash', done: i, total: files.length, current: f.relPath, bytes })
    try {
      hashes.set(f, await opts.hasher.hash(await f.getFile(), (n) => (bytes += n), control))
    } catch (err) {
      if (err instanceof CancelledError) throw err
      plan.errors.push(item(f, { reason: `No se pudo leer: ${errorMessage(err)}` }))
    }
  }

  // ---- Duplicados (ya guardados o repetidos en la selección) ----
  const seen = new Map<string, SourceFile>()
  const candidates: SourceFile[] = []
  for (const f of files) {
    const h = hashes.get(f)
    if (!h) continue
    if (opts.isKnown(h)) plan.duplicates.push(item(f, { reason: 'Ya está guardado' }))
    else if (seen.has(h)) plan.duplicates.push(item(f, { reason: `Repetido en la selección (igual que ${seen.get(h)!.relPath})` }))
    else {
      seen.set(h, f)
      candidates.push(f)
    }
  }

  // ---- Análisis ----
  const analysis = new Map<SourceFile, { exif: ExifInfo; verdict: Verdict; motion: boolean }>()
  for (let i = 0; i < candidates.length; i++) {
    await control.checkpoint()
    const f = candidates[i]
    opts.onProgress?.({ phase: 'analyze', done: i, total: candidates.length, current: f.relPath, bytes })
    let exif: ExifInfo = { date: null }
    let verdict: Verdict = { action: 'copy', status: 'ok' }
    let motion = false
    const blob = await f.getFile()
    try {
      exif = await opts.readExif(blob)
    } catch {
      // sin EXIF
    }
    if (opts.analyzer && !force.has(f.relPath)) {
      try {
        const features = await opts.analyzer.analyze(blob, { name: f.name, ext: extOf(f.name), media: isVideo(f.name) ? 'video' : 'image', livePhotoVideo: photoOfVideo.has(f), exif })
        verdict = classify(features, settings.filters)
        motion = !!features.bytes.motionPhoto
      } catch (err) {
        if (err instanceof CancelledError) throw err
        verdict = { action: 'copy', status: 'unverified', note: `No se pudo analizar: ${errorMessage(err)}` }
      }
    }
    if (force.has(f.relPath)) verdict = { action: 'copy', status: 'unverified', note: 'Incluido a petición del usuario aunque el análisis lo había descartado' }

    // iPhone: Safari puede entregar las HEIC convertidas a JPEG (archivos distintos en cada backup).
    if (opts.isIOS && ['jpg', 'jpeg'].includes(extOf(f.name)) && exif.make === 'Apple' && Math.abs(now().getTime() - f.lastModified) < 15 * 60_000) {
      plan.convertedByIOS.push(f.relPath)
    }
    if (opts.isIOS && exif.make === 'Apple' && !isVideo(f.name) && !pairs.some((p) => p.photo === f)) plan.appleWithoutVideo++

    if (verdict.action === 'discard') plan.discarded.push(item(f, { category: verdict.category as DiscardCategory, reason: verdict.reason }))
    else analysis.set(f, { exif, verdict, motion })
  }

  // ---- Rutas en el ZIP ----
  const used = new Set<string>()
  const placed = new Map<SourceFile, string>()
  const devicePrefix = settings.layout === 'per-device' ? `${sanitizeName(device.name)}/` : ''
  const ordered = [...analysis.keys()].sort((a, b) => Number(photoOfVideo.has(a)) - Number(photoOfVideo.has(b)))
  for (const f of ordered) {
    const a = analysis.get(f)!
    const hash = hashes.get(f)!
    const photo = photoOfVideo.get(f)
    let zipPath = ''
    const photoPath = photo && placed.get(photo)
    if (photoPath) {
      const dot = photoPath.lastIndexOf('.')
      const candidate = photoPath.slice(0, dot) + f.name.slice(f.name.lastIndexOf('.'))
      if (!used.has(candidate.toLowerCase())) zipPath = candidate
    }
    if (!zipPath) {
      const { date } = pickDate(a.exif.date, f.lastModified, now())
      const base = datedName(f.name, date, settings.dateInName)
      const dir = devicePrefix + folderFor(date)
      for (let n = 0; !zipPath; n++) {
        const p = `${dir}/${withSuffix(base, n)}`
        if (!used.has(p.toLowerCase())) zipPath = p
      }
    }
    used.add(zipPath.toLowerCase())
    placed.set(f, zipPath)
    const verdictNote = a.verdict.action === 'copy' && a.verdict.status !== 'ok' ? a.verdict.note : undefined
    const status = a.verdict.action === 'copy' && a.verdict.status === 'reduced' ? 'reduced' : 'unverified'
    plan.items.push({
      file: f,
      hash,
      zipPath,
      pairKey: photo ? photo.relPath : pairs.some((p) => p.photo === f) ? f.relPath : undefined,
      entry: {
        hash,
        size: f.size,
        originalName: f.name,
        sourcePath: f.relPath,
        diskPath: zipPath,
        exifDate: a.exif.date ? toLocalIso(a.exif.date) : null,
        fileDate: new Date(f.lastModified).toISOString(),
        deviceId: device.id,
        deviceName: device.name,
        status,
        note: verdictNote ?? 'Exportado en ZIP (modo compatible); se verifica al incorporarlo desde el disco',
        copiedAt: now().toISOString(),
        ...(a.motion ? { motionPhoto: true } : {}),
      },
    })
    if (a.motion) plan.motionPhotos++
    if (a.verdict.action === 'copy' && a.verdict.status === 'unverified') plan.unverified.push(item(f, { reason: a.verdict.note }))
    if (a.verdict.action === 'copy' && a.verdict.status === 'reduced') plan.reduced.push(item(f, { reason: a.verdict.note }))
  }
  // Enlazar parejas de Live Photo en el manifest del lote
  for (const it of plan.items) {
    const photo = photoOfVideo.get(it.file)
    const photoItem = photo && plan.items.find((x) => x.file === photo)
    if (photoItem) {
      it.entry.pair = photoItem.hash
      photoItem.entry.pair = it.hash
    }
  }
  return plan
}

/** Reparte en lotes de como máximo `maxBytes`, sin separar las Live Photos. */
export function splitBatches(items: CompatItem[], maxBytes: number): CompatItem[][] {
  const groups = new Map<string, CompatItem[]>()
  const order: string[] = []
  for (const it of items) {
    const k = it.pairKey ?? it.file.relPath
    if (!groups.has(k)) {
      groups.set(k, [])
      order.push(k)
    }
    groups.get(k)!.push(it)
  }
  const batches: CompatItem[][] = []
  let current: CompatItem[] = []
  let size = 0
  for (const k of order) {
    const g = groups.get(k)!
    const gs = g.reduce((a, x) => a + x.file.size, 0)
    if (current.length && size + gs > maxBytes) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(...g)
    size += gs
  }
  if (current.length) batches.push(current)
  return batches
}
