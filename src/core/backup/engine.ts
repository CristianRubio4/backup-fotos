import { classify, type DiscardCategory, type Features, type Verdict } from '../analysis/classify'
import { findLivePhotos } from '../analysis/pairing'
import { needsPreHash, planDedupe, type HashedFile } from '../dedupe'
import { ensureDiskId } from '../disk'
import type { EntryStatus, ManifestEntry } from '../manifest/schema'
import { ManifestStore, type ManifestRecovery } from '../manifest/store'
import { extOf, isVideo } from '../media'
import { datedName, folderFor, pickDate, toLocalIso, withSuffix } from '../naming'
import type { Device, Settings } from '../settings'
import {
  CancelledError,
  DiskDisconnectedError,
  DiskFullError,
  ManifestCorruptError,
  type Analyzer,
  type ExifInfo,
  type ExifReader,
  type Hasher,
  type RunControl,
  type SourceFile,
  type Target,
} from '../types'
import { SpeedMeter, type Counters, type Phase, type Progress } from './progress'

export interface ReportItem {
  name: string
  sourcePath: string
  size: number
  /** Ruta en el disco (copiado) o del archivo ya existente (duplicado). */
  diskPath?: string
  /** Motivo (descartes, duplicados, no verificados) o mensaje de error. */
  reason?: string
  /** Para descartados: tipo de problema. */
  category?: DiscardCategory
}

export type Outcome = 'completed' | 'cancelled' | 'disk-disconnected' | 'disk-full' | 'manifest-corrupt' | 'failed'

export interface BackupReport {
  outcome: Outcome
  failure?: string
  startedAt: string
  finishedAt: string
  diskId: string | null
  scanned: number
  ignored: { count: number; sample: string[] }
  copied: ReportItem[]
  /** Encontrados ya copiados en el disco aunque faltaban en el manifest (p. ej. tras una interrupción). */
  alreadyOnDisk: ReportItem[]
  duplicates: ReportItem[]
  /** No copiados por los filtros. Siguen en el origen; se pueden copiar igualmente. */
  discarded: ReportItem[]
  unverified: ReportItem[]
  /** Posibles versiones reducidas (fotos que quizá solo están completas en la nube). */
  reduced: ReportItem[]
  errors: ReportItem[]
  /** Parejas de Live Photo encontradas en la selección. */
  livePhotos: number
  /** Motion Photos (JPEG con vídeo incrustado) copiadas. */
  motionPhotos: number
  bytesCopied: number
  manifest: ManifestRecovery | null
}

export interface ScanResult {
  files: SourceFile[]
  /** Rutas de archivos que no son fotos ni vídeos. */
  ignored: string[]
}

export interface EngineInput {
  target: Target
  /** Nombre por defecto del disco si aún no tiene identificador. */
  diskName: string
  scan(onFound: (count: number) => void): Promise<ScanResult>
  hasher: Hasher
  readExif: ExifReader
  /** Si falta, no se analiza nada (todo se copia). */
  analyzer?: Analyzer
  /** Rutas de origen que el usuario quiere copiar aunque los filtros las descarten. */
  force?: Set<string>
  device: Device
  settings: Settings
  control: RunControl
  onProgress(p: Progress): void
  now?: () => Date
}

const SAVE_INTERVAL_MS = 30_000
const EMIT_INTERVAL_MS = 150

function item(f: SourceFile, extra: Partial<ReportItem> = {}): ReportItem {
  return { name: f.name, sourcePath: f.relPath, size: f.size, ...extra }
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.name && err.name !== 'Error' ? `${err.name}: ${err.message}` : err.message
  return String(err)
}

/** IMG_1.HEIC → IMG_1.MOV (conservando la extensión original del vídeo). */
function swapExt(path: string, fromName: string) {
  const dot = path.lastIndexOf('.')
  const ext = fromName.slice(fromName.lastIndexOf('.'))
  return (dot > path.lastIndexOf('/') ? path.slice(0, dot) : path) + ext
}

interface Analysis {
  exif: ExifInfo
  verdict: Verdict
  motionPhoto: boolean
  forced: boolean
}

export async function runBackup(input: EngineInput): Promise<BackupReport> {
  const { target, hasher, control, settings, device } = input
  const filters = settings.filters
  const force = input.force ?? new Set<string>()
  const now = input.now ?? (() => new Date())

  const report: BackupReport = {
    outcome: 'completed',
    startedAt: now().toISOString(),
    finishedAt: '',
    diskId: null,
    scanned: 0,
    ignored: { count: 0, sample: [] },
    copied: [],
    alreadyOnDisk: [],
    duplicates: [],
    discarded: [],
    unverified: [],
    reduced: [],
    errors: [],
    livePhotos: 0,
    motionPhotos: 0,
    bytesCopied: 0,
    manifest: null,
  }

  // ---- Progreso ----
  const counters: Counters = { copied: 0, duplicates: 0, discarded: 0, unverified: 0, errors: 0 }
  const progress: Progress = {
    phase: 'scan',
    doneBytes: 0,
    totalBytes: 0,
    phaseDone: 0,
    phaseTotal: 0,
    currentFile: null,
    counters,
    bytesPerSec: 0,
    etaSec: null,
  }
  const meter = new SpeedMeter()
  let lastEmit = 0
  const emit = (force = false) => {
    const t = Date.now()
    if (!force && t - lastEmit < EMIT_INTERVAL_MS) return
    lastEmit = t
    meter.sample(t, progress.doneBytes)
    progress.bytesPerSec = meter.rate()
    const left = progress.totalBytes - progress.doneBytes
    progress.etaSec = progress.bytesPerSec > 0 && left > 0 ? left / progress.bytesPerSec : null
    input.onProgress({ ...progress, counters: { ...counters } })
  }
  const setPhase = (phase: Phase, total: number) => {
    progress.phase = phase
    progress.phaseDone = 0
    progress.phaseTotal = total
    emit(true)
  }
  const onBytes = (n: number) => {
    progress.doneBytes += n
    emit()
  }
  /** Trabajo no previsto (reintentos, comprobar un archivo existente): se suma al total. */
  const extraBytes = (n: number) => {
    progress.totalBytes += n
  }
  const discardItem = (f: SourceFile, category: DiscardCategory, reason: string) => {
    report.discarded.push(item(f, { category, reason }))
    counters.discarded++
  }

  let store: ManifestStore | null = null
  let diskOk = true

  try {
    // ---- Disco y manifest ----
    if (!(await target.ping())) throw new DiskDisconnectedError()
    const disk = await ensureDiskId(target, input.diskName, now())
    report.diskId = disk.id
    const opened = await ManifestStore.open(target, disk.id, now())
    store = opened.store
    report.manifest = opened.recovery
    const manifest = store

    // ---- Escaneo ----
    setPhase('scan', 0)
    const scan = await input.scan((count) => {
      progress.phaseDone = count
      emit()
    })
    report.scanned = scan.files.length
    report.ignored = { count: scan.ignored.length, sample: scan.ignored.slice(0, 50) }

    const files: SourceFile[] = []
    for (const f of scan.files) {
      if (f.size === 0 && filters.corrupt && !force.has(f.relPath)) discardItem(f, 'corrupt', 'Archivo vacío (0 bytes)')
      else files.push(f)
    }

    // ---- Live Photos ----
    const pairs = findLivePhotos(files)
    report.livePhotos = pairs.length
    const photoOfVideo = new Map(pairs.map((p) => [p.video, p.photo]))

    // ---- Hashes (solo de los que comparten tamaño con algo) ----
    const preHash = needsPreHash(files, (s) => manifest.hasSize(s))
    const preHashSet = new Set(preHash)
    const sum = (list: SourceFile[]) => list.reduce((a, f) => a + f.size, 0)
    const copyFactor = settings.verifyHash ? 2 : 1
    // Estimación inicial: todo lo que no tiene hash se copiará; se ajusta tras deduplicar y analizar.
    progress.totalBytes = sum(preHash) + sum(files) * copyFactor

    setPhase('hash', preHash.length)
    const hashes = new Map<SourceFile, string>()
    for (const f of preHash) {
      await control.checkpoint()
      progress.currentFile = f.relPath
      try {
        hashes.set(f, await hasher.hash(await f.getFile(), onBytes, control))
      } catch (err) {
        if (err instanceof CancelledError) throw err
        report.errors.push(item(f, { reason: `No se pudo leer: ${errorMessage(err)}` }))
        counters.errors++
        progress.totalBytes -= f.size * (1 + copyFactor)
      }
      progress.phaseDone++
      emit()
    }

    // ---- Duplicados ----
    setPhase('dedupe', files.length)
    const hashed: HashedFile[] = files
      .filter((f) => !preHashSet.has(f) || hashes.has(f))
      .map((f) => ({ file: f, hash: hashes.get(f) ?? null }))
    const plan = planDedupe(hashed, (h) => manifest.findByHash(h))
    /** Dónde está (o quedará) cada foto en el disco, para colocar su vídeo de Live Photo al lado. */
    const placed = new Map<SourceFile, { diskPath: string; hash: string }>()
    for (const d of plan.onDisk) {
      report.duplicates.push(item(d.file, { diskPath: d.existing.diskPath, reason: 'Ya está en el disco' }))
      placed.set(d.file, { diskPath: d.existing.diskPath, hash: d.existing.hash })
    }
    for (const d of plan.inSelection) {
      report.duplicates.push(item(d.file, { reason: `Repetido en la selección (igual que ${d.original.relPath})` }))
    }
    counters.duplicates = report.duplicates.length

    // ---- Análisis: fecha EXIF y clasificación ----
    setPhase('analyze', plan.toCopy.length)
    const analysis = new Map<SourceFile, Analysis>()
    const toCopy: HashedFile[] = []
    for (const hf of plan.toCopy) {
      await control.checkpoint()
      const f = hf.file
      progress.currentFile = f.relPath
      const forced = force.has(f.relPath)
      let exif: ExifInfo = { date: null }
      let verdict: Verdict = { action: 'copy', status: 'ok' }
      let features: Features | undefined
      try {
        const blob = await f.getFile()
        try {
          exif = await input.readExif(blob)
        } catch {
          // Sin EXIF legible: se usará la fecha del archivo.
        }
        if (input.analyzer && !forced) {
          try {
            features = await input.analyzer.analyze(blob, {
              name: f.name,
              ext: extOf(f.name),
              media: isVideo(f.name) ? 'video' : 'image',
              livePhotoVideo: photoOfVideo.has(f),
              exif,
            })
            verdict = classify(features, filters)
          } catch (err) {
            if (err instanceof CancelledError) throw err
            // Si el análisis falla, se copia igualmente: nunca se descarta lo que no se ha comprobado.
            verdict = { action: 'copy', status: 'unverified', note: `No se pudo analizar: ${errorMessage(err)}` }
          }
        }
      } catch (err) {
        if (err instanceof CancelledError) throw err
        report.errors.push(item(f, { reason: `No se pudo leer: ${errorMessage(err)}` }))
        counters.errors++
        progress.phaseDone++
        continue
      }
      if (forced) verdict = { action: 'copy', status: 'unverified', note: 'Copiado a petición del usuario aunque el análisis lo había descartado' }

      if (verdict.action === 'discard') {
        discardItem(f, verdict.category, verdict.reason)
      } else {
        analysis.set(f, { exif, verdict, motionPhoto: !!features?.bytes.motionPhoto, forced })
        toCopy.push(hf)
      }
      progress.phaseDone++
      emit()
    }
    // Las fotos antes que sus vídeos de Live Photo, para que el vídeo tome el nombre de la foto.
    toCopy.sort((a, b) => Number(photoOfVideo.has(a.file)) - Number(photoOfVideo.has(b.file)))
    progress.totalBytes = sum(preHash) + sum(toCopy.map((h) => h.file)) * copyFactor
    progress.doneBytes = Math.min(progress.doneBytes, progress.totalBytes)

    // ---- Copia y verificación ----
    setPhase('copy', toCopy.length)
    const reserved = new Set<string>()
    let sinceSave = 0
    let lastSave = Date.now()

    const saveIfDue = async () => {
      if (sinceSave >= settings.saveEvery || Date.now() - lastSave > SAVE_INTERVAL_MS) {
        await manifest.flushJournal()
        sinceSave = 0
        lastSave = Date.now()
      }
    }

    type Fixed = 'originalName' | 'sourcePath' | 'size' | 'fileDate' | 'deviceId' | 'deviceName' | 'copiedAt'
    const register = (f: SourceFile, entry: Omit<ManifestEntry, Fixed>) => {
      manifest.add({
        ...entry,
        size: f.size,
        originalName: f.name,
        sourcePath: f.relPath,
        fileDate: new Date(f.lastModified).toISOString(),
        deviceId: device.id,
        deviceName: device.name,
        copiedAt: now().toISOString(),
      })
      reserved.add(entry.diskPath.toLowerCase())
      sinceSave++
    }

    /**
     * ¿Se puede usar esta ruta? free: libre (o resto vacío de una copia
     * interrumpida); same: ya contiene este mismo archivo; taken: otro archivo.
     */
    const tryPath = async (candidate: string, f: SourceFile, blob: Blob, known: { hash: string | null }) => {
      if (reserved.has(candidate.toLowerCase()) || manifest.hasDiskPath(candidate)) return 'taken'
      const st = await target.stat(candidate)
      if (st === null || st.size === 0) return 'free'
      if (st.size !== f.size) return 'taken'
      if (known.hash === null) {
        extraBytes(f.size)
        known.hash = await hasher.hash(blob, onBytes, control)
      }
      extraBytes(f.size)
      return (await target.hash(candidate, onBytes, control)) === known.hash ? 'same' : 'taken'
    }

    for (const hf of toCopy) {
      await control.checkpoint()
      const f = hf.file
      const a = analysis.get(f)!
      progress.currentFile = f.relPath
      progress.phase = 'copy'
      try {
        const blob = await f.getFile()
        const known = { hash: hf.hash }
        let path = ''
        let state: 'free' | 'same' | 'taken' = 'taken'

        // Vídeo de Live Photo: mismo nombre que su foto (IMG_1234.HEIC → IMG_1234.MOV).
        const photo = photoOfVideo.get(f)
        const photoPlace = photo && placed.get(photo)
        if (photoPlace) {
          path = swapExt(photoPlace.diskPath, f.name)
          state = await tryPath(path, f, blob, known)
        }
        if (state === 'taken') {
          const { date } = pickDate(a.exif.date, f.lastModified, now())
          const dir = folderFor(date)
          const base = datedName(f.name, date, settings.dateInName)
          for (let n = 0; state === 'taken'; n++) {
            path = `${dir}/${withSuffix(base, n)}`
            state = await tryPath(path, f, blob, known)
          }
        }

        const exifDate = a.exif.date ? toLocalIso(a.exif.date) : null
        const extra = {
          ...(photoPlace ? { pair: photoPlace.hash } : {}),
          ...(a.motionPhoto ? { motionPhoto: true } : {}),
        }

        if (state === 'same') {
          // Ya se copió antes pero no llegó al manifest: se registra sin volver a copiar.
          progress.doneBytes += f.size * copyFactor
          register(f, { hash: known.hash!, diskPath: path, exifDate, status: 'verified', note: 'Encontrado ya copiado en el disco', ...extra })
          report.alreadyOnDisk.push(item(f, { diskPath: path }))
          counters.copied++
        } else {
          const result = await copyAndVerify(f, blob, path, known.hash)
          // El estado final combina la verificación de la copia y el análisis del contenido.
          let status: EntryStatus = result.status
          let note = result.note
          if (status === 'verified' && a.verdict.action === 'copy' && a.verdict.status !== 'ok') {
            status = a.verdict.status
            note = a.verdict.note
          }
          register(f, { hash: result.hash, diskPath: path, exifDate, status, note, ...extra })
          known.hash = result.hash
          report.copied.push(item(f, { diskPath: path }))
          report.bytesCopied += f.size
          counters.copied++
          if (status === 'unverified') {
            report.unverified.push(item(f, { diskPath: path, reason: note }))
            counters.unverified++
          } else if (status === 'reduced') {
            report.reduced.push(item(f, { diskPath: path, reason: note }))
          }
        }
        if (a.motionPhoto) report.motionPhotos++
        placed.set(f, { diskPath: path, hash: known.hash! })
        // La foto de la pareja apunta también a su vídeo.
        if (photoPlace) manifest.annotate(photoPlace.hash, { pair: known.hash! })
        await saveIfDue()
      } catch (err) {
        if (err instanceof CancelledError) throw err
        // Se compara por nombre: los errores que vienen del Worker pierden su clase.
        if ((err as Error)?.name === 'QuotaExceededError') throw new DiskFullError()
        if (!(await target.ping())) throw new DiskDisconnectedError()
        report.errors.push(item(f, { reason: errorMessage(err) }))
        counters.errors++
      }
      progress.phaseDone++
      emit()
    }

    async function copyAndVerify(f: SourceFile, blob: Blob, path: string, expected: string | null) {
      let note: string | undefined
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (attempt > 1) extraBytes(f.size * copyFactor)
        progress.phase = 'copy'
        const copied = await target.copyIn(path, blob, onBytes, control)
        if (expected !== null && copied !== expected) {
          // El archivo cambió entre el cálculo del hash y la copia: vale lo que se ha copiado.
          note = 'El archivo de origen cambió durante el backup'
        }
        if (settings.verifyHash) {
          progress.phase = 'verify'
          emit(true)
          const back = await target.hash(path, onBytes, control)
          if (back === copied) return { hash: copied, status: (note ? 'unverified' : 'verified') as EntryStatus, note }
        } else {
          const st = await target.stat(path)
          if (st?.size === f.size) {
            return { hash: copied, status: 'unverified' as EntryStatus, note: note ?? 'Solo se comprobó el tamaño (verificación por hash desactivada)' }
          }
        }
        await target.remove(path)
      }
      throw new Error('La copia en el disco no coincide con el original (2 intentos). El original sigue intacto.')
    }
  } catch (err) {
    if (err instanceof CancelledError) report.outcome = 'cancelled'
    else if (err instanceof DiskDisconnectedError) {
      report.outcome = 'disk-disconnected'
      diskOk = false
    } else if (err instanceof DiskFullError) report.outcome = 'disk-full'
    else if (err instanceof ManifestCorruptError) report.outcome = 'manifest-corrupt'
    else {
      report.outcome = 'failed'
      report.failure = errorMessage(err)
    }
  } finally {
    progress.currentFile = null
    if (store && diskOk) {
      setPhase('save', 1)
      try {
        await store.flushJournal()
        await store.compact(now())
      } catch (err) {
        // El diario ya guardado permite recuperar en el próximo backup.
        if (report.outcome === 'completed') {
          report.outcome = 'failed'
          report.failure = `No se pudo guardar el manifest: ${errorMessage(err)}`
        }
      }
    }
    report.finishedAt = now().toISOString()
    emit(true)
  }
  return report
}
