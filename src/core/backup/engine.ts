import { classify, type DiscardCategory, type Features, type Verdict } from '../analysis/classify'
import { findLivePhotos } from '../analysis/pairing'
import { friendlyError } from '../errors'
import { needsPreHash, planDedupe, type DedupePlan, type HashedFile } from '../dedupe'
import { ensureDiskId } from '../disk'
import type { EntryStatus, ManifestEntry } from '../manifest/schema'
import { ManifestStore, type ManifestRecovery } from '../manifest/store'
import { extOf, isVideo } from '../media'
import { datedName, dominantCamera, joinPath, mirrorPath, pickDate, runFolderName, targetDir, toLocalIso, withSuffix } from '../naming'
import { mapPool } from '../pool'
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
  /** Carpetas del origen en las que se ha buscado (hasta 500) y cuántas son en total. */
  searched?: { count: number; sample: string[] }
  /** Carpeta de esta copia en el disco ("iPhone 15 Pro - 2026-10-19 14h30"), si se usa una por backup. */
  folder?: string
}

export interface ScanResult {
  files: SourceFile[]
  /** Rutas de archivos que no son fotos ni vídeos. */
  ignored: string[]
  /** Archivos o carpetas que no se han podido leer (se informa y se sigue con el resto). */
  unreadable?: Array<{ relPath: string; reason: string }>
  /** Carpetas recorridas (incluida la de origen). */
  dirs?: string[]
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
  /**
   * Con "una carpeta por copia": crea (o abre) la carpeta de esta copia dentro
   * del destino y la devuelve como destino. Sin ella, se copia en la raíz.
   */
  openRunFolder?: (name: string) => Promise<Target>
  /** Nombre de carpeta de una copia anterior (para "Copiar igualmente" en la misma copia). */
  runFolderName?: string
  /** Nombre del origen para la carpeta (p. ej. el móvil por cable), consultado tras el escaneo; si da null, se deduce del EXIF. */
  sourceName?: () => string | null
  /**
   * Origen lento de leer (móvil por cable): cada archivo se lee UNA sola vez, al copiarlo
   * (sin pasada previa de análisis). Se copia todo, verificado; la fecha es la del archivo.
   */
  readOnce?: boolean
  /** Origen lento (móvil por cable): no se leen fotos de muestra para adivinar el nombre del móvil. */
  slowSource?: boolean
  /**
   * "Solo lo nuevo en cada copia": fotos que ya están en OTRAS copias del disco (por su
   * huella). Lo que está ahí no se copia de nuevo. Las rutas vienen desde la raíz del disco.
   */
  knownElsewhere?: (hash: string) => ManifestEntry | undefined
  /**
   * Copiar con la misma estructura de carpetas y los mismos nombres que en el origen
   * ("Pictures/Screenshots/captura.png"). `stripFirst`: quitar el nombre del origen de la ruta.
   */
  mirror?: { stripFirst: boolean }
  /** Archivos que se hashean/analizan a la vez (uno por Worker). La copia siempre es de uno en uno. */
  concurrency?: number
  now?: () => Date
}

/** FAT32 admite archivos de hasta 4 GiB − 1 byte. */
export const FAT32_MAX_FILE = 4 * 1024 ** 3 - 1
const FAT32_REASON =
  'No se ha podido copiar: ocupa más de 4 GB y el disco parece estar formateado en FAT32, que no admite archivos tan grandes. Formatea el disco en exFAT (ver Ayuda)'

const SAVE_INTERVAL_MS = 30_000
/** Archivos que se copian a la vez en la copia rápida. */
const COPY_LANES = 4
const EMIT_INTERVAL_MS = 150

function item(f: SourceFile, extra: Partial<ReportItem> = {}): ReportItem {
  return { name: f.name, sourcePath: f.relPath, size: f.size, ...extra }
}

/** Mensaje en español (los errores del navegador llegan en inglés y con nombres técnicos). */
function errorMessage(err: unknown) {
  return friendlyError(err)
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
  const { hasher, control, settings, device } = input
  /** Destino real: la carpeta elegida o, con una carpeta por copia, la de esta copia. */
  let target = input.target
  const snapshot = settings.runFolder && !input.encrypted && !!input.openRunFolder
  const filters = settings.filters
  const force = input.force ?? new Set<string>()
  const fat32Limit = input.fat32Limit ?? FAT32_MAX_FILE
  const concurrency = Math.max(1, input.concurrency ?? 1)
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
  /** Elementos del informe cuya ruta ya es desde la raíz del disco (están en otra copia). */
  const fromRoot = new WeakSet<ReportItem>()
  let diskOk = true

  try {
    if (!(await target.ping())) throw new DiskDisconnectedError()

    // ---- Escaneo ----
    setPhase('scan', 0)
    const scan = await input.scan((count) => {
      progress.phaseDone = count
      emit()
    })
    report.scanned = scan.files.length
    report.ignored = { count: scan.ignored.length, sample: scan.ignored.slice(0, 50) }
    if (scan.dirs) report.searched = { count: scan.dirs.length, sample: scan.dirs.slice(0, 500) }
    for (const u of scan.unreadable ?? []) {
      report.errors.push({ name: u.relPath.split('/').pop() ?? u.relPath, sourcePath: u.relPath, size: 0, reason: `No se ha podido leer: ${u.reason}` })
      counters.errors++
    }

    const files: SourceFile[] = []
    for (const f of scan.files) {
      if (f.size === 0 && filters.corrupt && !force.has(f.relPath)) discardItem(f, 'corrupt', 'Archivo vacío (0 bytes)')
      else files.push(f)
    }

    // ---- Carpeta de esta copia ----
    // "iPhone 15 Pro - 2026-10-19 14h30": se crea dentro del destino y TODO va dentro
    // (fotos y archivos de control). Cada copia es completa e independiente.
    if (snapshot) {
      const name = input.runFolderName ?? runFolderName(new Date(report.startedAt), input.sourceName?.() ?? (input.slowSource ? null : await guessCamera(files, input.readExif, concurrency)))
      report.folder = name
      const parent = target
      target = await input.openRunFolder!(name).catch(async (err) => {
        throw (await parent.ping()) ? err : new DiskDisconnectedError()
      })
    }

    // ---- Disco y manifest ----
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
    // Solo se releen las del disco con el mismo tamaño que alguna de las que se van a
    // copiar (las demás no pueden ser iguales): en un disco lleno de fotos, mucho más rápido.
    if (!snapshot && opened.recovery.source === 'new' && !input.encrypted) {
      setPhase('disk', 0)
      const sizes = new Set(files.map((f) => f.size))
      const inc = await incorporateDiskFiles({
        target,
        store: manifest,
        control,
        sizes,
        concurrency,
        onPlanned: (n, bytes) => {
          progress.phaseTotal = n
          progress.totalBytes += bytes
          emit(true)
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

    // ---- Live Photos ----
    const pairs = findLivePhotos(files)
    report.livePhotos = pairs.length
    const photoOfVideo = new Map(pairs.map((p) => [p.video, p.photo]))

    // ---- Hashes (solo de los que comparten tamaño con algo) ----
    // Copia rápida: sin pasada previa de huellas; las repetidas se detectan al copiar.
    const preHash = input.readOnce ? [] : needsPreHash(files, (s) => manifest.hasSize(s))
    const preHashSet = new Set(preHash)
    const sum = (list: SourceFile[]) => list.reduce((a, f) => a + f.size, 0)
    const copyFactor = settings.verifyHash ? 2 : 1
    // Estimación inicial: todo lo que no tiene hash se copiará; se ajusta tras deduplicar y analizar.
    const baseBytes = progress.doneBytes
    progress.totalBytes = baseBytes + sum(preHash) + sum(files) * copyFactor

    setPhase('hash', preHash.length)
    const hashes = new Map<SourceFile, string>()
    // Copia rápida: las huellas ya conocidas (de backups anteriores) salen de la caché, sin leer nada.
    // Así se saltan al instante lo ya copiado al continuar una copia o con "solo lo nuevo".
    if (input.readOnce && input.hashCache) {
      for (const f of files) {
        const h = await input.hashCache.get(f).catch(() => undefined)
        if (h) hashes.set(f, h)
      }
    }
    // En paralelo (varios Workers): calcular hashes es CPU + lectura del origen, no escritura en el disco.
    const hashErrors = await mapPool(preHash, concurrency, async (f) => {
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
        return null
      } catch (err) {
        if (err instanceof CancelledError) throw err
        progress.totalBytes -= f.size * (1 + copyFactor)
        return item(f, { reason: `No se pudo leer: ${errorMessage(err)}` })
      } finally {
        progress.phaseDone++
        emit()
      }
    })
    for (const e of hashErrors) {
      if (e) {
        report.errors.push(e)
        counters.errors++
      }
    }

    /**
     * Con la estructura del origen, cada archivo va a SU ruta: una foto repetida en otra carpeta
     * del móvil también se copia allí. Solo se salta lo que ya está en su ruta de esta copia
     * (continuar una copia) o, con "solo lo nuevo", lo que ya está en otra copia del disco.
     */
    const planMirror = (list: HashedFile[]): DedupePlan => {
      const out: DedupePlan = { toCopy: [], onDisk: [], inSelection: [] }
      // Rutas de esta copia ya registradas (al continuar una copia): búsqueda directa, sin recorrer la lista cada vez.
      const registered = new Map(manifest.entries().map((e) => [e.diskPath.toLowerCase(), e]))
      for (const hf of list) {
        const at = mirrorPath(hf.file.relPath, input.mirror!.stripFirst)
        const there = registered.get(at.toLowerCase())
        // Ya está en su sitio en esta copia: misma huella o, si no se conoce, misma ruta y mismo tamaño. No se lee nada.
        const here = there && (hf.hash !== null ? there.hash === hf.hash : there.size === hf.file.size) ? there : undefined
        const elsewhere = !here && hf.hash !== null ? input.knownElsewhere?.(hf.hash) : undefined
        if (here) out.onDisk.push({ file: hf.file, existing: { ...here, diskPath: at } })
        else if (elsewhere) out.onDisk.push({ file: hf.file, existing: elsewhere })
        else out.toCopy.push(hf)
      }
      return out
    }

    // ---- Duplicados ----
    setPhase('dedupe', files.length)
    const hashed: HashedFile[] = files
      .filter((f) => !preHashSet.has(f) || hashes.has(f))
      .map((f) => ({ file: f, hash: hashes.get(f) ?? null }))
    const plan = input.mirror ? planMirror(hashed) : planDedupe(hashed, (h) => manifest.findByHash(h) ?? input.knownElsewhere?.(h))
    /** Dónde está (o quedará) cada foto en el disco, para colocar su vídeo de Live Photo al lado. */
    const placed = new Map<SourceFile, { diskPath: string; hash: string }>()
    for (const d of plan.onDisk) {
      const own = manifest.hasDiskPath(d.existing.diskPath)
      const dup = item(d.file, { diskPath: d.existing.diskPath, reason: own ? 'Ya está en esta copia' : 'Ya está en una copia anterior' })
      if (!own) fromRoot.add(dup)
      report.duplicates.push(dup)
      // Solo lo de esta copia sirve para colocar al lado el vídeo de una Live Photo.
      if (own) placed.set(d.file, { diskPath: d.existing.diskPath, hash: d.existing.hash })
    }
    for (const d of plan.inSelection) {
      report.duplicates.push(item(d.file, { reason: `Repetido en la selección (igual que ${d.original.relPath})` }))
    }
    counters.duplicates = report.duplicates.length

    // ---- Análisis: fecha EXIF y clasificación ----
    setPhase('analyze', plan.toCopy.length)
    const analysis = new Map<SourceFile, Analysis>()
    const toCopy: HashedFile[] = []
    type Analyzed = { ok: Analysis } | { error: string }
    const analyzed = await mapPool(plan.toCopy, concurrency, async (hf): Promise<Analyzed> => {
      await control.checkpoint()
      const f = hf.file
      progress.currentFile = f.relPath
      const forced = force.has(f.relPath)
      let exif: ExifInfo = { date: null }
      let verdict: Verdict = { action: 'copy', status: 'ok' }
      let features: Features | undefined
      // Origen lento (cable): no se lee el archivo para analizarlo; se copia tal cual y se verifica al copiar.
      if (input.readOnce && !forced) {
        progress.phaseDone++
        emit()
        return { ok: { exif, verdict, motionPhoto: false, forced } }
      }
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
        return { error: `No se pudo leer: ${errorMessage(err)}` }
      } finally {
        progress.phaseDone++
        emit()
      }
      if (forced) verdict = { action: 'copy', status: 'unverified', note: 'Copiado a petición del usuario aunque el análisis lo había descartado' }
      return { ok: { exif, verdict, motionPhoto: !!features?.bytes.motionPhoto, forced } }
    })
    // Resultados en el orden original (el informe y la copia son deterministas).
    plan.toCopy.forEach((hf, i) => {
      const r = analyzed[i]
      if ('error' in r) {
        report.errors.push(item(hf.file, { reason: r.error }))
        counters.errors++
      } else if (r.ok.verdict.action === 'discard') {
        discardItem(hf.file, r.ok.verdict.category, r.ok.verdict.reason)
      } else {
        analysis.set(hf.file, r.ok)
        toCopy.push(hf)
      }
    })
    // Las fotos antes que sus vídeos de Live Photo, para que el vídeo tome el nombre de la foto.
    toCopy.sort((a, b) => Number(photoOfVideo.has(a.file)) - Number(photoOfVideo.has(b.file)))
    progress.totalBytes = baseBytes + sum(preHash) + sum(toCopy.map((h) => h.file)) * copyFactor
    progress.doneBytes = Math.min(progress.doneBytes, progress.totalBytes)

    // ---- Copia y verificación ----
    setPhase('copy', toCopy.length)
    const reserved = new Set<string>()
    let sinceSave = 0
    let lastSave = Date.now()

    // Con varios archivos a la vez, los guardados del registro van de uno en uno.
    let saving: Promise<void> = Promise.resolve()
    const saveIfDue = () =>
      (saving = saving
        .catch(() => {})
        .then(async () => {
          if (sinceSave >= settings.saveEvery || Date.now() - lastSave > SAVE_INTERVAL_MS) {
            sinceSave = 0
            lastSave = Date.now()
            await manifest.flushJournal()
          }
        }))

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
      // Se aparta ya: con varios archivos a la vez, dos no pueden acabar en la misma ruta.
      reserved.add(candidate.toLowerCase())
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

    /** Con "una carpeta por dispositivo", una subcarpeta con su nombre. */
    const deviceDir = settings.layout === 'per-device' ? device.name : null

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
        let dir: string
        let base: string
        if (input.mirror) {
          // Misma estructura que en el móvil: Pictures/Screenshots/captura.png
          const m = mirrorPath(f.relPath, input.mirror.stripFirst)
          const cut = m.lastIndexOf('/')
          dir = cut < 0 ? '' : m.slice(0, cut)
          base = m.slice(cut + 1)
        } else {
          dir = targetDir({ byDate: !snapshot, device: deviceDir, date })
          base = datedName(f.name, date, settings.dateInName)
        }
        for (let n = 0; state === 'taken'; n++) {
          path = joinPath(dir, withSuffix(base, n))
          state = await tryPath(path, f, blob, known)
        }
      }
      return { path, state, photoPlace }
    }

    /** Tras un error de escritura en un archivo > 4 GB, el disco es casi seguro FAT32: no se reintentan los demás. */
    let fat32Suspected = false

    /** Copia (y verifica) un archivo. */
    const copyOne = async (hf: HashedFile) => {
      await control.checkpoint()
      const f = hf.file
      const a = analysis.get(f)!
      progress.currentFile = f.relPath
      progress.phase = 'copy'
      if (fat32Suspected && f.size > fat32Limit) {
        report.fat32.push(item(f, { reason: FAT32_REASON }))
        counters.errors++
        progress.phaseDone++
        return
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
          // Copia rápida: una foto ya guardada se detecta al copiarla (la huella sale de la propia copia) y se quita.
          // Con la estructura del origen, una foto repetida en OTRA carpeta del móvil sí se queda: cada carpeta completa.
          const twin = input.readOnce
            ? input.mirror
              ? input.knownElsewhere?.(result.hash)
              : (manifest.findByHash(result.hash) ?? input.knownElsewhere?.(result.hash))
            : undefined
          if (twin) {
            await withDisk(() => target.remove(path))
            await input.hashCache?.set(f, result.hash)
            const own = manifest.hasDiskPath(twin.diskPath)
            const dup = item(f, { diskPath: twin.diskPath, reason: own ? 'Repetida en la selección: ya se ha copiado una igual' : 'Ya está en una copia anterior' })
            if (!own) fromRoot.add(dup)
            report.duplicates.push(dup)
            counters.duplicates++
            if (own) placed.set(f, { diskPath: twin.diskPath, hash: twin.hash })
            progress.phaseDone++
            emit()
            return
          }
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

    // Copia rápida: varios archivos a la vez. Mientras uno se escribe y se verifica en el disco,
    // los siguientes ya se están leyendo del origen (con el móvil por cable, el programa no para nunca).
    // Si no, de uno en uno y en orden (la foto de una Live Photo antes que su vídeo).
    const lanes = input.readOnce ? COPY_LANES : 1
    let next = 0
    let failed = false
    let failure: unknown
    await Promise.all(
      Array.from({ length: Math.min(lanes, toCopy.length) }, async () => {
        while (!failed && next < toCopy.length) {
          try {
            await copyOne(toCopy[next++])
          } catch (err) {
            // El primer fallo grave (cancelar, disco desconectado o lleno) para todo; los demás carriles terminan lo suyo.
            if (!failed) failure = err
            failed = true
          }
        }
      }),
    )
    if (failed) throw failure
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
    // Con una carpeta por copia, las rutas del informe se dan desde la carpeta elegida ("iPhone… - 2026…/foto.jpg").
    if (report.folder) {
      for (const list of [report.copied, report.alreadyOnDisk, report.duplicates, report.unverified, report.reduced]) {
        for (const it of list) if (it.diskPath && !fromRoot.has(it)) it.diskPath = joinPath(report.folder, it.diskPath)
      }
    }
    report.finishedAt = now().toISOString()
    emit(true)
  }
  return report
}

/** Móvil o cámara de las fotos, leyendo el EXIF de una muestra (para nombrar la carpeta antes de copiar). */
async function guessCamera(files: SourceFile[], readExif: ExifReader, concurrency: number) {
  const photos = files.filter((f) => !isVideo(f.name))
  const step = Math.max(1, Math.floor(photos.length / 40))
  const sample = photos.filter((_, i) => i % step === 0).slice(0, 40)
  const exifs = await mapPool(sample, concurrency, async (f) => {
    try {
      return await readExif(await f.getFile())
    } catch {
      return { date: null } as ExifInfo
    }
  })
  return dominantCamera(exifs)
}
