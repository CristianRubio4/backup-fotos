import { ManifestCorruptError, type Target } from '../types'
import {
  JOURNAL_DIR,
  MANIFEST_BAK,
  MANIFEST_FILE,
  MANIFEST_TMP,
  parseJournal,
  parseManifest,
  type JournalSegment,
  type Manifest,
  type ManifestEntry,
} from './schema'

export type ManifestSource = 'new' | 'main' | 'tmp' | 'bak'

export interface ManifestRecovery {
  /** De qué archivo se cargó. 'bak' o 'tmp' significan que el principal estaba dañado o era antiguo. */
  source: ManifestSource
  /** Segmentos del diario (backups interrumpidos) incorporados. */
  journalApplied: number
  /** Segmentos del diario ilegibles (sus archivos se detectan igualmente al recopiar). */
  journalCorrupt: number
}

const JOURNAL_RE = /^(\d+)\.json$/

function journalPath(seq: number) {
  return `${JOURNAL_DIR}/${String(seq).padStart(6, '0')}.json`
}

/**
 * Escritura segura: guarda la versión actual (si es válida) en .bak, escribe
 * en .tmp, la relee y valida, y solo entonces reemplaza el principal.
 *
 * No usamos FileSystemHandle.move(): en Chrome, createWritable() ya escribe en
 * un archivo de intercambio (.crswap) y solo sustituye el original al cerrar,
 * así que el reemplazo es atómico; y move() sobre un destino existente no
 * está garantizado en todas las versiones.
 */
export async function safeWriteManifest(target: Target, manifest: Manifest) {
  const text = JSON.stringify(manifest)
  const current = await target.readText(MANIFEST_FILE)
  if (parseManifest(current)) await target.writeText(MANIFEST_BAK, current!)

  await target.writeText(MANIFEST_TMP, text)
  assertWritten(await target.readText(MANIFEST_TMP), manifest)

  await target.writeText(MANIFEST_FILE, text)
  assertWritten(await target.readText(MANIFEST_FILE), manifest)

  await target.remove(MANIFEST_TMP)
}

function assertWritten(text: string | null, expected: Manifest) {
  const back = parseManifest(text)
  if (!back || back.entries.length !== expected.entries.length) {
    throw new Error('El manifest escrito en el disco no se ha podido verificar')
  }
}

export class ManifestStore {
  private byHash = new Map<string, ManifestEntry>()
  /** Todas las entradas, incluidas las de mismo contenido en otra ruta (con la estructura del origen, cada archivo en su carpeta). */
  private all: ManifestEntry[] = []
  /** Ruta en el disco (sin distinguir mayúsculas) → huella. */
  private byPath = new Map<string, string>()
  private diskPaths = new Set<string>()
  private sizes = new Set<number>()
  private pending: ManifestEntry[] = []
  private journalFiles: string[] = []
  private nextSeq = 1

  private constructor(
    private target: Target,
    private meta: Omit<Manifest, 'entries'>,
  ) {}

  /**
   * Carga el manifest (principal, .tmp o .bak, el más reciente válido) y
   * aplica el diario de backups interrumpidos. Si existen archivos de
   * manifest pero ninguno es válido, lanza ManifestCorruptError.
   */
  static async open(target: Target, diskId: string, now = new Date(), opts: { ignoreCorrupt?: boolean } = {}) {
    const [mainText, tmpText] = await Promise.all([
      target.readText(MANIFEST_FILE),
      target.readText(MANIFEST_TMP),
    ])
    const main = parseManifest(mainText)
    const tmp = parseManifest(tmpText)

    let manifest: Manifest | null = null
    let source: ManifestSource = 'new'
    if (main && (!tmp || main.updatedAt >= tmp.updatedAt)) {
      manifest = main
      source = 'main'
    } else if (tmp) {
      manifest = tmp
      source = 'tmp'
    } else {
      const bakText = await target.readText(MANIFEST_BAK)
      const bak = parseManifest(bakText)
      if (bak) {
        manifest = bak
        source = 'bak'
      } else if (!opts.ignoreCorrupt && (mainText !== null || tmpText !== null || bakText !== null)) {
        throw new ManifestCorruptError()
      }
    }

    const iso = now.toISOString()
    manifest ??= { version: 1, diskId, createdAt: iso, updatedAt: iso, entries: [] }
    const { entries, ...meta } = manifest
    const store = new ManifestStore(target, meta)
    entries.forEach((e) => store.index(e))

    const recovery: ManifestRecovery = { source, journalApplied: 0, journalCorrupt: 0 }
    const names = (await target.list(JOURNAL_DIR)).filter((n) => JOURNAL_RE.test(n)).sort()
    for (const name of names) {
      const path = `${JOURNAL_DIR}/${name}`
      store.journalFiles.push(path)
      const seq = Number(JOURNAL_RE.exec(name)![1])
      store.nextSeq = Math.max(store.nextSeq, seq + 1)
      const seg = parseJournal(await target.readText(path))
      if (!seg) {
        recovery.journalCorrupt++
        continue
      }
      seg.entries.forEach((e) => store.index(e))
      recovery.journalApplied++
    }
    return { store, recovery }
  }

  get diskId() {
    return this.meta.diskId
  }

  get size() {
    return this.byHash.size
  }

  get pendingCount() {
    return this.pending.length
  }

  /** Todas las entradas (una por archivo del disco). */
  entries() {
    return [...this.all]
  }

  /** Huella del archivo registrado en esa ruta, si lo hay. */
  hashAt(path: string) {
    return this.byPath.get(path.toLowerCase())
  }

  findByHash(hash: string) {
    return this.byHash.get(hash)
  }

  hasSize(size: number) {
    return this.sizes.has(size)
  }

  hasDiskPath(path: string) {
    return this.diskPaths.has(path.toLowerCase())
  }

  /**
   * Registra un archivo copiado. Mismo contenido en otra ruta: se registra también
   * (copias con la misma estructura que el origen). Misma ruta ya registrada: no se repite.
   */
  add(entry: ManifestEntry) {
    if (this.diskPaths.has(entry.diskPath.toLowerCase())) return
    this.index(entry)
    this.pending.push(entry)
  }

  /**
   * Añade datos a una entrada existente (p. ej. enlazar una Live Photo con su
   * vídeo). Se guarda en el disco con la siguiente compactación.
   */
  annotate(hash: string, patch: Pick<Partial<ManifestEntry>, 'pair' | 'status' | 'note'>) {
    const e = this.byHash.get(hash)
    if (e) Object.assign(e, patch)
  }

  /** Quita una entrada (p. ej. un archivo liberado del origen que ya no existe en el disco). */
  remove(hash: string) {
    if (!this.byHash.has(hash)) return
    this.byHash.delete(hash)
    for (const e of this.all.filter((x) => x.hash === hash)) {
      this.diskPaths.delete(e.diskPath.toLowerCase())
      this.byPath.delete(e.diskPath.toLowerCase())
    }
    this.all = this.all.filter((x) => x.hash !== hash)
    this.pending = this.pending.filter((p) => p.hash !== hash)
  }

  /** Guarda las entradas nuevas en un segmento del diario (rápido, para poder reanudar). */
  async flushJournal() {
    if (this.pending.length === 0) return
    // Lo que se registre mientras se escribe va al siguiente segmento.
    const entries = this.pending
    this.pending = []
    const seg: JournalSegment = { version: 1, seq: this.nextSeq++, entries }
    const path = journalPath(seg.seq)
    try {
      await this.target.writeText(path, JSON.stringify(seg))
    } catch (err) {
      this.pending = [...entries, ...this.pending]
      throw err
    }
    this.journalFiles.push(path)
  }

  /** Escribe el manifest completo de forma segura y elimina el diario ya incorporado. */
  async compact(now = new Date()) {
    const manifest: Manifest = { ...this.meta, updatedAt: now.toISOString(), entries: this.entries() }
    await safeWriteManifest(this.target, manifest)
    this.meta.updatedAt = manifest.updatedAt
    this.pending = []
    for (const path of this.journalFiles) await this.target.remove(path)
    this.journalFiles = []
  }

  private index(e: ManifestEntry) {
    // Comparación sin distinguir mayúsculas: Windows, macOS y exFAT no las distinguen.
    const key = e.diskPath.toLowerCase()
    if (this.diskPaths.has(key)) return
    if (!this.byHash.has(e.hash)) this.byHash.set(e.hash, e)
    this.all.push(e)
    this.byPath.set(key, e.hash)
    this.diskPaths.add(key)
    this.sizes.add(e.size)
  }
}
