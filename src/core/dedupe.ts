import type { ManifestEntry } from './manifest/schema'
import type { SourceFile } from './types'

export interface HashedFile {
  file: SourceFile
  /** null cuando su tamaño es único: no puede tener duplicado y el hash se calcula durante la copia. */
  hash: string | null
}

export interface DedupePlan {
  toCopy: HashedFile[]
  /** Ya están en el disco (mismo hash en el manifest). */
  onDisk: Array<{ file: SourceFile; existing: ManifestEntry }>
  /** Repetidos dentro de la propia selección: se copia solo el primero. */
  inSelection: Array<{ file: SourceFile; original: SourceFile }>
}

/**
 * Archivos que necesitan hash antes de copiar: los que comparten tamaño con
 * algo del manifest o con otro archivo de la selección. El resto solo pueden
 * ser nuevos (comparar primero por tamaño).
 */
export function needsPreHash(files: SourceFile[], manifestHasSize: (size: number) => boolean) {
  const count = new Map<number, number>()
  for (const f of files) count.set(f.size, (count.get(f.size) ?? 0) + 1)
  return files.filter((f) => manifestHasSize(f.size) || count.get(f.size)! > 1)
}

export function planDedupe(
  files: HashedFile[],
  findInManifest: (hash: string) => ManifestEntry | undefined,
): DedupePlan {
  const plan: DedupePlan = { toCopy: [], onDisk: [], inSelection: [] }
  const seen = new Map<string, SourceFile>()
  for (const hf of files) {
    if (hf.hash === null) {
      plan.toCopy.push(hf)
      continue
    }
    const existing = findInManifest(hf.hash)
    if (existing) {
      plan.onDisk.push({ file: hf.file, existing })
      continue
    }
    const original = seen.get(hf.hash)
    if (original) {
      plan.inSelection.push({ file: hf.file, original })
      continue
    }
    seen.set(hf.hash, hf.file)
    plan.toCopy.push(hf)
  }
  return plan
}
