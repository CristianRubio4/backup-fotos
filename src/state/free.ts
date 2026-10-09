import { create } from 'zustand'
import { ManifestStore } from '../core/manifest/store'
import { findFreeable, freeFiles, type FreeCandidate, type FreeResult, type FreeScan, type KnownDisk } from '../core/tools/free'
import { db } from '../db'
import { workerHasher } from '../platform/io'
import { saveDiskIndex } from './app'
import { diskTarget } from './keys'
import { readyDisk, runTool, scanSources, useTools } from './tools'

interface FreeState {
  scan: (FreeScan & { diskName: string; skippedSources: string[] }) | null
  result: FreeResult | null
  runScan(): Promise<void>
  runDelete(candidates: FreeCandidate[]): Promise<void>
  reset(): void
}

export const useFree = create<FreeState>((set) => ({
  scan: null,
  result: null,

  reset: () => set({ scan: null, result: null }),

  async runScan() {
    let disk
    try {
      disk = readyDisk()
    } catch (err) {
      return useTools.setState({ error: (err as Error).message })
    }
    set({ scan: null, result: null })
    await runTool('free-scan', 'Buscando fotos que ya están a salvo', async (c, onProgress) => {
      onProgress({ done: 0, total: 0, current: 'Recorriendo las carpetas de origen…' })
      // Para poder borrar hace falta permiso de escritura en el origen.
      const { files, skipped } = await scanSources(c, 'readwrite', disk.handle)
      await saveDiskIndex(disk)
      const { store } = await ManifestStore.open(diskTarget(disk), disk.diskId!)
      const otherDisks: KnownDisk[] = (await db.listDiskIndexes())
        .filter((i) => i.diskId !== disk.diskId)
        .map((i) => ({ name: i.name, statuses: new Map(i.entries) }))
      const scan = await findFreeable({ files, store, activeDiskName: disk.name, otherDisks, hasher: workerHasher, cache: db.hashCache(), control: c, onProgress })
      set({ scan: { ...scan, diskName: disk.name, skippedSources: skipped } })
    })
  },

  async runDelete(candidates) {
    let disk
    try {
      disk = readyDisk()
    } catch (err) {
      return useTools.setState({ error: (err as Error).message })
    }
    await runTool('free-delete', 'Liberando espacio', async (c, onProgress) => {
      const result = await freeFiles({
        candidates,
        target: diskTarget(disk),
        hasher: workerHasher,
        control: c,
        onProgress,
        remove: async (cand) => {
          if (!cand.file.parent) throw new Error('no se puede borrar desde aquí')
          await cand.file.parent.removeEntry(cand.file.name)
        },
        onDeleted: (cand) =>
          db.addDeletion({ at: new Date().toISOString(), source: cand.file.relPath.split('/')[0], path: cand.file.relPath, size: cand.file.size, hash: cand.hash, disks: cand.disks }),
      })
      set({ result, scan: null })
    })
  },
}))
