import { useEffect, useState } from 'react'
import { Card } from '../components/ui'
import { formatBytes, formatDateTime } from '../core/format'
import { db, type DeletionRecord } from '../db'
import { useApp } from '../state/app'

const LABEL: Record<string, string> = {
  completed: 'Completado',
  cancelled: 'Cancelado',
  'disk-disconnected': 'Disco desconectado',
  'disk-full': 'Disco lleno',
  'manifest-corrupt': 'Manifest dañado',
  failed: 'Error',
}

export function HistoryScreen() {
  const history = useApp((s) => s.history)
  const [deletions, setDeletions] = useState<DeletionRecord[]>([])
  useEffect(() => {
    void db.listDeletions().then(setDeletions)
  }, [])

  return (
    <>
      <Card title="Backups">
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no se ha hecho ningún backup desde este navegador.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {history.map((h) => (
              <li key={h.id} className="py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{formatDateTime(h.finishedAt)}</span>
                  <span className={h.outcome === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                    {LABEL[h.outcome] ?? h.outcome}
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  💽 {h.diskName} · {h.deviceName} · {h.copied} copiados ({formatBytes(h.bytesCopied)}) · {h.duplicates} duplicados ·{' '}
                  {h.discarded} descartados · {h.errors} errores
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {deletions.length > 0 && (
        <Card title={`Borrado al liberar espacio (${deletions.length})`}>
          <p className="mb-2 text-xs text-slate-500">
            Archivos borrados de las carpetas de origen después de comprobar que estaban verificados en el backup. Total: {formatBytes(deletions.reduce((a, d) => a + d.size, 0))}.
          </p>
          <ul className="max-h-96 space-y-1 overflow-auto text-xs">
            {deletions.map((d) => (
              <li key={d.id} className="border-b border-slate-100 pb-1 dark:border-slate-800">
                <span className="font-medium break-all">{d.path}</span>
                <span className="text-slate-500"> · {formatBytes(d.size)} · {formatDateTime(d.at)} · copia en: {d.disks.join(', ')}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
