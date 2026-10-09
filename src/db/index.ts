import { openDB, type DBSchema } from 'idb'
import type { BackupReport } from '../core/backup/engine'
import { newId } from '../core/disk'
import type { EntryStatus } from '../core/manifest/schema'
import { withDefaults, type Device, type Settings } from '../core/settings'
import type { HashCache, SourceFile } from '../core/types'

export interface HistoryRecord {
  id?: number
  startedAt: string
  finishedAt: string
  outcome: BackupReport['outcome']
  diskId: string | null
  diskName: string
  deviceName: string
  copied: number
  duplicates: number
  discarded: number
  unverified: number
  errors: number
  bytesCopied: number
}

/** Carpeta de origen (cámara, capturas, WhatsApp…). */
export interface SourceRecord {
  key: string
  name: string
  handle: FileSystemDirectoryHandle
  addedAt: string
}

/** Disco de backup (rotación de varios discos). */
export interface DiskRecord {
  key: string
  /** Identificador del archivo .backup-disk-id (null hasta la primera conexión). */
  diskId: string | null
  name: string
  handle: FileSystemDirectoryHandle
  addedAt: string
  lastBackupAt?: string
  lastBackupFiles?: number
  lastCheckAt?: string
  encrypted?: boolean
}

/** Qué hashes contiene cada disco (para saber en cuántos discos está una foto). */
export interface DiskIndex {
  diskId: string
  name: string
  updatedAt: string
  entries: Array<[hash: string, status: EntryStatus]>
}

export interface DeletionRecord {
  id?: number
  at: string
  source: string
  path: string
  size: number
  hash: string
  disks: string[]
}

interface Schema extends DBSchema {
  kv: { key: string; value: unknown }
  history: { key: number; value: HistoryRecord }
  sources: { key: string; value: SourceRecord }
  disks: { key: string; value: DiskRecord }
  hashCache: { key: string; value: { size: number; lastModified: number; hash: string } }
  diskIndex: { key: string; value: DiskIndex }
  deletions: { key: number; value: DeletionRecord }
  /** Modo compatible: hashes ya exportados en ZIP desde este navegador. */
  exported: { key: string; value: { at: string; zip: string } }
}

const dbp = openDB<Schema>('backup-fotos', 3, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('kv')
      db.createObjectStore('history', { keyPath: 'id', autoIncrement: true })
    }
    if (oldVersion < 2) {
      db.createObjectStore('sources', { keyPath: 'key' })
      db.createObjectStore('disks', { keyPath: 'key' })
      db.createObjectStore('hashCache')
      db.createObjectStore('diskIndex', { keyPath: 'diskId' })
      db.createObjectStore('deletions', { keyPath: 'id', autoIncrement: true })
    }
    if (oldVersion < 3) db.createObjectStore('exported')
  },
})

async function get<T>(key: string): Promise<T | undefined> {
  return (await (await dbp).get('kv', key)) as T | undefined
}

async function set(key: string, value: unknown) {
  await (await dbp).put('kv', value, key)
}

export const db = {
  async getSettings(): Promise<Settings> {
    return withDefaults(await get<Partial<Settings>>('settings'))
  },
  setSettings: (s: Settings) => set('settings', s),

  /** Identificador de este dispositivo; se crea la primera vez. */
  async getDevice(): Promise<Device> {
    let d = await get<Device>('device')
    if (!d) {
      d = { id: newId(), name: guessDeviceName() }
      await set('device', d)
    }
    return d
  },
  setDevice: (d: Device) => set('device', d),

  // ---- Orígenes y discos ----
  async listSources() {
    const d = await dbp
    const list = await d.getAll('sources')
    // Migración desde la versión con un único origen.
    const legacy = await get<FileSystemDirectoryHandle>('source')
    if (legacy && list.length === 0) {
      const rec: SourceRecord = { key: newId(), name: legacy.name, handle: legacy, addedAt: new Date().toISOString() }
      await d.put('sources', rec)
      await d.delete('kv', 'source')
      return [rec]
    }
    return list.sort((a, b) => a.addedAt.localeCompare(b.addedAt))
  },
  putSource: async (s: SourceRecord) => void (await (await dbp).put('sources', s)),
  deleteSource: async (key: string) => void (await (await dbp).delete('sources', key)),

  async listDisks() {
    const d = await dbp
    const list = await d.getAll('disks')
    const legacy = await get<FileSystemDirectoryHandle>('dest')
    if (legacy && list.length === 0) {
      const rec: DiskRecord = { key: newId(), diskId: null, name: legacy.name, handle: legacy, addedAt: new Date().toISOString() }
      await d.put('disks', rec)
      await d.delete('kv', 'dest')
      return [rec]
    }
    return list.sort((a, b) => a.addedAt.localeCompare(b.addedAt))
  },
  putDisk: async (r: DiskRecord) => void (await (await dbp).put('disks', r)),
  deleteDisk: async (key: string) => void (await (await dbp).delete('disks', key)),

  getActiveDisk: () => get<string>('activeDisk'),
  setActiveDisk: (key: string) => set('activeDisk', key),

  // ---- Caché de hashes del origen ----
  hashCache(): HashCache {
    const key = (f: SourceFile) => f.cacheKey ?? f.relPath
    return {
      async get(f) {
        const c = await (await dbp).get('hashCache', key(f))
        return c && c.size === f.size && c.lastModified === f.lastModified ? c.hash : undefined
      },
      async set(f, hash) {
        await (await dbp).put('hashCache', { size: f.size, lastModified: f.lastModified, hash }, key(f))
      },
    }
  },

  // ---- Índice de cada disco ----
  putDiskIndex: async (i: DiskIndex) => void (await (await dbp).put('diskIndex', i)),
  listDiskIndexes: async () => (await dbp).getAll('diskIndex'),

  // ---- Historial ----
  async addHistory(r: HistoryRecord) {
    await (await dbp).add('history', r)
  },
  async listHistory() {
    return (await (await dbp).getAll('history')).reverse()
  },
  async addDeletion(r: DeletionRecord) {
    await (await dbp).add('deletions', r)
  },
  async exportedHashes() {
    return new Set(await (await dbp).getAllKeys('exported'))
  },
  async addExported(hashes: string[], zip: string) {
    const tx = (await dbp).transaction('exported', 'readwrite')
    const at = new Date().toISOString()
    await Promise.all([...hashes.map((h) => tx.store.put({ at, zip }, h)), tx.done])
  },
  async clearExported() {
    await (await dbp).clear('exported')
  },
  async listDeletions() {
    return (await (await dbp).getAll('deletions')).reverse()
  },
}

function guessDeviceName() {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'Móvil Android'
  if (/iPhone|iPad/i.test(ua)) return 'iPhone'
  if (/Mac/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'PC Windows'
  return 'Este dispositivo'
}
