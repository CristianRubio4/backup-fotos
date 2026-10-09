import { openDB, type DBSchema } from 'idb'
import type { BackupReport } from '../core/backup/engine'
import { newId } from '../core/disk'
import { DEFAULT_SETTINGS, type Device, type Settings } from '../core/settings'

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

interface Schema extends DBSchema {
  kv: { key: string; value: unknown }
  history: { key: number; value: HistoryRecord }
}

const dbp = openDB<Schema>('backup-fotos', 1, {
  upgrade(db) {
    db.createObjectStore('kv')
    db.createObjectStore('history', { keyPath: 'id', autoIncrement: true })
  },
})

async function get<T>(key: string): Promise<T | undefined> {
  return (await (await dbp).get('kv', key)) as T | undefined
}

async function set(key: string, value: unknown) {
  await (await dbp).put('kv', value, key)
}

export const db = {
  getSource: () => get<FileSystemDirectoryHandle>('source'),
  setSource: (h: FileSystemDirectoryHandle) => set('source', h),
  getDest: () => get<FileSystemDirectoryHandle>('dest'),
  setDest: (h: FileSystemDirectoryHandle) => set('dest', h),

  async getSettings(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...(await get<Partial<Settings>>('settings')) }
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

  async addHistory(r: HistoryRecord) {
    await (await dbp).add('history', r)
  },
  async listHistory() {
    return (await (await dbp).getAll('history')).reverse()
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
