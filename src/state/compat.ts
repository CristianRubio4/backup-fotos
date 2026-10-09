import { downloadZip } from 'client-zip'
import { create } from 'zustand'
import { planCompat, splitBatches, type CompatItem, type CompatPlan } from '../core/compat/plan'
import { Controller } from '../core/control'
import { parseManifest } from '../core/manifest/schema'
import { isMedia } from '../core/media'
import { CancelledError, type Hasher, type SourceFile } from '../core/types'
import { db } from '../db'
import { createAnalyzer } from '../platform/analyzer'
import { io, workerExif, workerHasher } from '../platform/io'
import { keepScreenOn } from '../platform/power'
import { useApp } from './app'

export const isIOS = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

export interface CompatProgress {
  phase: 'hash' | 'analyze'
  done: number
  total: number
  current: string | null
  bytes: number
}

interface CompatState {
  files: SourceFile[]
  ignored: number
  manifestHashes: Set<string>
  manifestName: string | null
  plan: CompatPlan | null
  batches: CompatItem[][]
  downloaded: number[]
  progress: CompatProgress | null
  zipping: number | null
  error: string | null
  addFiles(list: FileList | null): void
  clearFiles(): void
  importManifest(file: File): Promise<void>
  analyze(force?: string[]): Promise<void>
  downloadBatch(index: number): Promise<void>
  cancel(): void
}

let ctl: Controller | null = null
/** Hashes ya calculados en esta sesión (para no repetirlos al volver a analizar). */
const sessionHashes = new Map<string, string>()

const cachedHasher: Hasher = {
  async hash(file, onProgress, control) {
    const f = file as File
    const key = `${f.name}|${f.size}|${f.lastModified}`
    const hit = sessionHashes.get(key)
    if (hit) {
      onProgress(file.size)
      return hit
    }
    const h = await workerHasher.hash(file, onProgress, control)
    sessionHashes.set(key, h)
    return h
  },
}

function toSource(f: File): SourceFile {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
  return { relPath: rel, name: f.name, size: f.size, lastModified: f.lastModified, getFile: async () => f }
}

export const useCompat = create<CompatState>((set, get) => ({
  files: [],
  ignored: 0,
  manifestHashes: new Set(),
  manifestName: null,
  plan: null,
  batches: [],
  downloaded: [],
  progress: null,
  zipping: null,
  error: null,

  addFiles(list) {
    if (!list) return
    const known = new Set(get().files.map((f) => `${f.relPath}|${f.size}`))
    const added: SourceFile[] = []
    let ignored = get().ignored
    for (const f of Array.from(list)) {
      if (!isMedia(f.name)) {
        ignored++
        continue
      }
      const s = toSource(f)
      const k = `${s.relPath}|${s.size}`
      if (!known.has(k)) {
        known.add(k)
        added.push(s)
      }
    }
    set({ files: [...get().files, ...added], ignored, plan: null, batches: [], downloaded: [] })
  },

  clearFiles: () => set({ files: [], ignored: 0, plan: null, batches: [], downloaded: [] }),

  async importManifest(file) {
    const m = parseManifest(await file.text())
    if (!m) {
      set({ error: 'Ese archivo no es un manifest válido (o es de un disco cifrado, que no se puede leer aquí).' })
      return
    }
    set({ manifestHashes: new Set(m.entries.map((e) => e.hash)), manifestName: `${file.name} (${m.entries.length} archivos)`, plan: null, error: null })
  },

  async analyze(force) {
    const { files, manifestHashes } = get()
    if (!files.length) return
    const { settings, device } = useApp.getState()
    const c = new Controller()
    ctl = c
    await io.reset()
    keepScreenOn(true)
    set({ error: null, progress: { phase: 'hash', done: 0, total: files.length, current: null, bytes: 0 } })
    try {
      const exported = await db.exportedHashes()
      const plan = await planCompat({
        files,
        isKnown: (h) => exported.has(h) || manifestHashes.has(h),
        hasher: cachedHasher,
        readExif: workerExif,
        analyzer: createAnalyzer(settings.filters),
        settings,
        device,
        control: c,
        force: force ? new Set(force) : undefined,
        isIOS,
        onProgress: (p) => set({ progress: p }),
      })
      set({ plan, batches: splitBatches(plan.items, settings.zipBatchMB * 1024 * 1024), downloaded: [] })
    } catch (err) {
      if (!(err instanceof CancelledError)) set({ error: (err as Error).message })
    } finally {
      keepScreenOn(false)
      ctl = null
      set({ progress: null })
    }
  },

  async downloadBatch(index) {
    const { batches, plan } = get()
    const batch = batches[index]
    if (!batch || !plan) return
    set({ zipping: index, error: null })
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const name = `backup-fotos-${stamp}-lote-${index + 1}-de-${batches.length}.zip`
      const manifest = {
        version: 1,
        note: 'Lote exportado en el modo compatible. Al copiarlo al disco de backup, usa "Herramientas → Incorporar archivos sueltos" en Chrome o Edge para registrarlo.',
        createdAt: new Date().toISOString(),
        entries: batch.map((i) => i.entry),
      }
      // ZIP sin compresión (las fotos ya están comprimidas) que conserva la fecha original de cada archivo.
      async function* entries() {
        for (const i of batch) yield { name: i.zipPath, input: (await i.file.getFile()) as File, lastModified: new Date(i.file.lastModified) }
        yield { name: `.backup-lote-${stamp}-${index + 1}.json`, input: JSON.stringify(manifest, null, 2), lastModified: new Date() }
      }
      const response = downloadZip(entries())
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      await db.addExported(batch.map((i) => i.hash), name)
      set({ downloaded: [...get().downloaded, index] })
    } catch (err) {
      set({ error: `No se pudo generar el ZIP: ${(err as Error).message}. Prueba con lotes más pequeños en Ajustes.` })
    } finally {
      set({ zipping: null })
    }
  },

  cancel() {
    ctl?.cancel()
    void io.cancel()
  },
}))
