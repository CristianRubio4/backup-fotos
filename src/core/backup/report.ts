import type { BackupReport } from './engine'

/**
 * Incorpora al informe el resultado de "Copiar igualmente": los archivos que
 * se han copiado (o que resultaron estar ya en el disco) salen de la lista de
 * descartados.
 */
export function mergeForced(prev: BackupReport, forced: BackupReport): BackupReport {
  const handled = new Set([...forced.copied, ...forced.alreadyOnDisk, ...forced.duplicates].map((i) => i.sourcePath))
  return {
    ...prev,
    discarded: prev.discarded.filter((d) => !handled.has(d.sourcePath)),
    copied: [...prev.copied, ...forced.copied],
    alreadyOnDisk: [...prev.alreadyOnDisk, ...forced.alreadyOnDisk],
    duplicates: [...prev.duplicates, ...forced.duplicates],
    unverified: [...prev.unverified, ...forced.unverified],
    reduced: [...prev.reduced, ...forced.reduced],
    errors: [...prev.errors, ...forced.errors],
    bytesCopied: prev.bytesCopied + forced.bytesCopied,
    finishedAt: forced.finishedAt,
  }
}
