import { formatBytes } from '../core/format'
import { useTools } from '../state/tools'
import { Button, Card, ProgressBar } from './ui'

/** Progreso de la herramienta en curso (comprobar, restaurar, liberar espacio…). */
export function JobProgress() {
  const { job, cancel } = useTools()
  if (!job) return null
  const { done, total, current } = job.progress
  const pct = total > 0 ? (done / total) * 100 : 0
  return (
    <Card title={job.label}>
      <ProgressBar value={pct} large />
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
        <span>{total > 0 ? `${done} de ${total}` : 'Preparando…'}</span>
        <span className="text-muted">{job.bytesPerSec > 0 ? `${formatBytes(job.bytesPerSec)}/s · ` : ''}{formatBytes(job.bytes)} leídos</span>
      </div>
      {current && <p className="mt-1 truncate text-xs text-muted" title={current}>{current}</p>}
      <p className="mt-2 text-xs text-muted">Mantén la pestaña abierta y el disco conectado.</p>
      <Button variant="danger" className="mt-3" onClick={cancel}>Cancelar</Button>
    </Card>
  )
}
