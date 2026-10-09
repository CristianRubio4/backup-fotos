import { useEffect, useState } from 'react'
import { History as HistoryIcon, Trash2 } from 'lucide-react'
import { Card, PageHeader } from '../components/ui'
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
      <PageHeader title="Historial" subtitle="Backups hechos desde este navegador y archivos liberados" />
      <Card title="Backups" icon={HistoryIcon}>
        {history.length === 0 ? (
          <p className="text-sm text-muted">Todavía no se ha hecho ningún backup desde este navegador.</p>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{formatDateTime(h.finishedAt)}</span>
                  <span className={h.outcome === 'completed' ? 'text-ok' : 'text-warn'}>
                    {LABEL[h.outcome] ?? h.outcome}
                  </span>
                </div>
                <div className="text-xs text-muted">
                  {h.diskName} · {h.deviceName} · {h.copied} copiados ({formatBytes(h.bytesCopied)}) · {h.duplicates} duplicados ·{' '}
                  {h.discarded} descartados · {h.errors} errores
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {deletions.length > 0 && (
        <Card title={`Borrado al liberar espacio (${deletions.length})`} icon={Trash2}>
          <p className="mb-2 text-xs text-muted">
            Archivos borrados de las carpetas de origen después de comprobar que estaban verificados en el backup. Total: {formatBytes(deletions.reduce((a, d) => a + d.size, 0))}.
          </p>
          <ul className="max-h-96 space-y-1 overflow-auto text-xs">
            {deletions.map((d) => (
              <li key={d.id} className="border-b border-line pb-1">
                <span className="font-medium break-all">{d.path}</span>
                <span className="text-muted"> · {formatBytes(d.size)} · {formatDateTime(d.at)} · copia en: {d.disks.join(', ')}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
