import { classify, type DiscardCategory, type Features, type Verdict } from '../analysis/classify'
import { findLivePhotos } from '../analysis/pairing'
import { needsPreHash, planDedupe, type HashedFile } from '../dedupe'
import { ensureDiskId } from '../disk'
import type { EntryStatus, ManifestEntry } from '../manifest/schema'
import { ManifestStore, type ManifestRecovery } from '../manifest/store'
import { extOf, isVideo } from '../media'
import { datedName, folderFor, pickDate, sanitizeName, toLocalIso, withSuffix } from '../naming'
import { incorporateDiskFiles } from './incorporate'
import type { Device, Settings } from '../settings'
import {
  CancelledError,
  DiskDisconnectedError,
  DiskFullError,
  ManifestCorruptError,
  type Analyzer,
  type ExifInfo,
  type ExifReader,
  type HashCache,
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
  /** Archivos de más de 4 GB que no se han podido copiar porque el disco es FAT32. */
  fat32: ReportItem[]
  /** Parejas de Live Photo encontradas en la selección. */
  livePhotos: number
  /** Motion Photos (JPEG con vídeo incrustado) copiadas. */
  motionPhotos: number
  /** Fotos que ya estaban en el disco (copiadas fuera de la app) incorporadas al manifest. */
  incorporated: number
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
  /**
   * Si el disco se desconecta durante la copia, el motor llama a esta función
   * y espera a que se resuelva (cuando vuelve el disco con este id) para
   * continuar. Si no se indica, el backup termina con 'disk-disconnected'.
   */
  waitForDisk?: (diskId: string) => Promise<void>
  /** Tamaño máximo de archivo en FAT32 (configurable solo para los tests). */
  fat32Limit?: number
  /** Caché de hashes del origen: solo se recalcula el hash de archivos nuevos o modificados. */
  hashCache?: HashCache
  /** Disco cifrado: nombres aleatorios en el disco, sin fecha ni nombre original. */
  encrypted?: boolean
  now?: () => Date
}

/** FAT32 admite archivos de hasta 4 GiB − 1 byte. */
export const FAT32_MAX_FILE = 4 * 1024 ** 3 - 1
const FAT32_REASON =
  'No se ha podido copiar: ocupa más de 4 GB y el disco parece estar formateado en FAT32, que no admite archivos tan grandes. Formatea el disco en exFAT (ver Ayuda)'

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
  const fat32Limit = input.fat32Limit ?? FAT32_MAX_FILE
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
    fat32: [],
    livePhotos: 0,
    motionPhotos: 0,
    incorporated: 0,
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
    waitingDisk: false,
  }
  const meter = new SpeedMeter()
  let lastEmit = 0
  const emit = (force = false) => {
    const t = Date.now()
    if (!force && t - lastEmit < EMIT_INTERVAL_MS) return
    lastEmit = t
    // Un reintento tras una desconexión vuelve a contar bytes ya contados.
    progress.totalBytes = Math.max(progress.totalBytes, progress.doneBytes)
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

    /**
     * Ejecuta una operación sobre el disco. Si falla porque el disco ya no
     * está, espera a que vuelva el MISMO disco (waitForDisk) y la repite.
     * Cada operación envuelta es repetible sin duplicar nada.
     */
    const withDisk = async <T>(fn: () => Promise<T>): Promise<T> => {
      for (;;) {
        try {
          return await fn()
        } catch (err) {
          if (err instanceof CancelledError) throw err
          if (await target.ping()) throw err
          if (!input.waitForDisk) throw new DiskDisconnectedError()
          progress.waitingDisk = true
          emit(true)
          await input.waitForDisk(disk.id)
          progress.waitingDisk = false
          emit(true)
        }
      }
    }

    // ---- Primer uso de un disco con fotos previas: incorporarlas al manifest ----
    if (opened.recovery.source === 'new' && !input.encrypted) {
      setPhase('disk', 0)
      const inc = await incorporateDiskFiles({
        target,
        store: manifest,
        control,
        onPlanned: (files, bytes) => {
          progress.phaseTotal = files
          progress.totalBytes += bytes
        },
        onProgress: (p) => {
          progress.phaseDone = p.done
          progress.currentFile = p.current
          emit()
        },
        onBytes,
        now,
      })
      report.incorporated = inc.added
      if (inc.added > 0) await manifest.flushJournal()
    }

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
    const baseBytes = progress.doneBytes
    progress.totalBytes = baseBytes + sum(preHash) + sum(files) * copyFactor

    setPhase('hash', preHash.length)
    const hashes = new Map<SourceFile, string>()
    for (const f of preHash) {
      await control.checkpoint()
      progress.currentFile = f.relPath
      try {
        const cached = await input.hashCache?.get(f)
        if (cached) {
          hashes.set(f, cached)
          onBytes(f.size)
        } else {
          const h = await hasher.hash(await f.getFile(), onBytes, control)
          hashes.set(f, h)
          await input.hashCache?.set(f, h)
        }
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
    progress.totalBytes = baseBytes + sum(preHash) + sum(toCopy.map((h) => h.file)) * copyFactor
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

    /** Con "una carpeta por dispositivo": Móvil de Ana/2026/10/… */
    const devicePrefix = settings.layout === 'per-device' ? `${sanitizeName(device.name)}/` : ''

    /** Elige la ruta en el disco: junto a su foto si es el vídeo de una Live Photo; si no, año/mes + nombre con fecha. */
    const choosePath = async (f: SourceFile, a: Analysis, blob: Blob, known: { hash: string | null }) => {
      let path = ''
      let state: 'free' | 'same' | 'taken' = 'taken'
      // Vídeo de Live Photo: mismo nombre que su foto (IMG_1234.HEIC → IMG_1234.MOV).
      const photo = photoOfVideo.get(f)
      const photoPlace = photo && placed.get(photo)
      if (input.encrypted) {
        // Disco cifrado: el nombre no revela nada (ni fecha, ni nombre original, ni tipo).
        for (; state === 'taken'; ) {
          const id = crypto.randomUUID().replaceAll('-', '')
          path = `${id.slice(0, 2)}/${id}.bin`
          state = await tryPath(path, f, blob, known)
        }
        return { path, state, photoPlace }
      }
      if (photoPlace) {
        path = swapExt(photoPlace.diskPath, f.name)
        state = await tryPath(path, f, blob, known)
      }
      if (state === 'taken') {
        const { date } = pickDate(a.exif.date, f.lastModified, now())
        const dir = devicePrefix + folderFor(date)
        const base = datedName(f.name, date, settings.dateInName)
        for (let n = 0; state === 'taken'; n++) {
          path = `${dir}/${withSuffix(base, n)}`
          state = await tryPath(path, f, blob, known)
        }
      }
      return { path, state, photoPlace }
    }

    /** Tras un error de escritura en un archivo > 4 GB, el disco es casi seguro FAT32: no se reintentan los demás. */
    let fat32Suspected = false

    for (const hf of toCopy) {
      await control.checkpoint()
      const f = hf.file
      const a = analysis.get(f)!
      progress.currentFile = f.relPath
      progress.phase = 'copy'
      if (fat32Suspected && f.size > fat32Limit) {
        report.fat32.push(item(f, { reason: FAT32_REASON }))
        counters.errors++
        progress.phaseDone++
        continue
      }
      try {
        const blob = await f.getFile()
        const known = { hash: hf.hash }
        const { path, state, photoPlace } = await withDisk(() => choosePath(f, a, blob, known))

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
          const result = await withDisk(() => copyAndVerify(f, blob, path, known.hash))
          // El estado final combina la verificación de la copia y el análisis del contenido.
          let status: EntryStatus = result.status
          let note = result.note
          if (status === 'verified' && a.verdict.action === 'copy' && a.verdict.status !== 'ok') {
            status = a.verdict.status
            note = a.verdict.note
          }
          register(f, { hash: result.hash, diskPath: path, exifDate, status, note, ...extra })
          await input.hashCache?.set(f, result.hash)
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
        await withDisk(saveIfDue)
      } catch (err) {
        if (err instanceof CancelledError || err instanceof DiskDisconnectedError) throw err
        if (f.size > fat32Limit) {
          // FAT32 no admite archivos de 4 GB o más. No se interrumpe el resto del backup.
          fat32Suspected = true
          report.fat32.push(item(f, { reason: `${FAT32_REASON} (${errorMessage(err)})` }))
          counters.errors++
        } else if ((err as Error)?.name === 'QuotaExceededError') {
          // Se compara por nombre: los errores que vienen del Worker pierden su clase.
          throw new DiskFullError()
        } else {
          report.errors.push(item(f, { reason: errorMessage(err) }))
          counters.errors++
        }
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
        if (report.outcome === 'completed' || report.outcome === 'cancelled') {
          if (!(await target.ping().catch(() => false))) report.outcome = 'disk-disconnected'
          else {
            report.outcome = 'failed'
            report.failure = `No se pudo guardar el manifest: ${errorMessage(err)}`
          }
        }
      }
    }
    report.finishedAt = now().toISOString()
    emit(true)
  }
  return report
}
