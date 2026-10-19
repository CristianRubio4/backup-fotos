import { readDiskId } from '../core/disk'
import type { ManifestEntry } from '../core/manifest/schema'
import { ManifestStore } from '../core/manifest/store'
import type { DiskRecord } from '../db'
import { FsaTarget } from '../platform/fsa-target'
import { diskTarget } from './keys'

/** Un conjunto de fotos del disco: una copia ("Móvil - fecha hora") o la estructura por fecha de la raíz. */
export interface BackupSet {
  name: string
  entries: ManifestEntry[]
}

/**
 * Copias del destino. Cada carpeta con su propio registro (.backup-disk-id y
 * manifest) es una copia; sus rutas se dan desde la raíz ("Copia…/foto.jpg").
 * Solo se leen los registros (pequeños), nunca las fotos.
 */
export async function loadSets(d: DiskRecord): Promise<BackupSet[]> {
  const sets: BackupSet[] = []
  if (d.diskId) {
    const { store } = await ManifestStore.open(diskTarget(d), d.diskId)
    if (store.entries().length) sets.push({ name: 'Por fecha (año/mes)', entries: store.entries() })
  }
  if (d.encrypted) return sets
  const copies: BackupSet[] = []
  for await (const [name, h] of d.handle.entries()) {
    if (h.kind !== 'directory' || name.startsWith('.') || name.startsWith('$')) continue
    const sub = new FsaTarget(h as FileSystemDirectoryHandle)
    const info = await readDiskId(sub).catch(() => null)
    if (!info) continue
    try {
      const { store } = await ManifestStore.open(sub, info.id)
      copies.push({ name, entries: store.entries().map((e) => ({ ...e, diskPath: `${name}/${e.diskPath}` })) })
    } catch {
      // Copia con el registro dañado: se omite (sus fotos siguen en su carpeta).
    }
  }
  // Las copias más recientes primero (el nombre acaba en la fecha y hora).
  copies.sort((a, b) => b.name.slice(-16).localeCompare(a.name.slice(-16)))
  return [...sets, ...copies]
}

/** Índice por huella de todo lo que ya hay en las copias del disco (para "Solo lo nuevo"). */
export async function knownOnDisk(d: DiskRecord): Promise<Map<string, ManifestEntry>> {
  const known = new Map<string, ManifestEntry>()
  for (const s of await loadSets(d).catch(() => [])) for (const e of s.entries) if (!known.has(e.hash)) known.set(e.hash, e)
  return known
}
