import { Card } from '../components/ui'
import { formatBytes, formatDateTime } from '../core/format'
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
  if (history.length === 0) return <p className="text-slate-500">Todavía no se ha hecho ningún backup desde este navegador.</p>
  return (
    <Card title="Historial">
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
    </Card>
  )
}
