import { Alert, Button, Card, ProgressBar, Stat } from '../components/ui'
import { PHASES } from '../core/backup/progress'
import { formatBytes, formatDuration } from '../core/format'
import { useApp } from '../state/app'

export function ProgressScreen() {
  const { progress: p, paused, running, pause, resume, cancel } = useApp()

  if (!running) return <p className="text-slate-500">No hay ningún backup en curso.</p>
  if (!p) return <p className="text-slate-500">Preparando…</p>

  const pct = p.totalBytes > 0 ? (p.doneBytes / p.totalBytes) * 100 : 0
  const current = PHASES.findIndex((ph) => ph.id === p.phase)

  return (
    <>
      <Alert tone="info">Mantén esta pestaña abierta y el disco conectado hasta que termine.</Alert>

      <Card>
        <ol className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {PHASES.map((ph, i) => (
            <li
              key={ph.id}
              className={
                i === current
                  ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                  : i < current
                    ? 'text-slate-500 line-through decoration-slate-300'
                    : 'text-slate-400'
              }
            >
              {i + 1}. {ph.label}
            </li>
          ))}
        </ol>

        <div className="mb-2 flex items-end justify-between">
          <span className="text-4xl font-bold tabular-nums">{Math.floor(pct)}%</span>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {formatBytes(p.doneBytes)} de {formatBytes(p.totalBytes)}
          </span>
        </div>
        <ProgressBar value={pct} large />

        <div className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
          <span>
            {paused ? '⏸ En pausa' : PHASES[current]?.label}
            {p.phase === 'scan' ? ` · ${p.phaseDone} encontrados` : p.phaseTotal > 0 ? ` · ${Math.min(p.phaseDone + 1, p.phaseTotal)} de ${p.phaseTotal} archivos` : ''}
          </span>
          <span className="sm:text-right">
            {formatBytes(p.bytesPerSec)}/s · quedan {formatDuration(p.etaSec)}
          </span>
        </div>
        {p.currentFile && <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400" title={p.currentFile}>{p.currentFile}</p>}
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Copiados" value={p.counters.copied} tone="ok" />
        <Stat label="Duplicados omitidos" value={p.counters.duplicates} />
        <Stat label="Descartados" value={p.counters.discarded} tone="warn" />
        <Stat label="No verificados" value={p.counters.unverified} tone="warn" />
        <Stat label="Errores" value={p.counters.errors} tone={p.counters.errors ? 'error' : undefined} />
      </div>

      <div className="flex flex-wrap gap-2">
        {paused ? (
          <Button variant="primary" onClick={resume}>
            ▶ Reanudar
          </Button>
        ) : (
          <Button onClick={pause}>⏸ Pausar</Button>
        )}
        <Button
          variant="danger"
          onClick={() => {
            if (confirm('¿Cancelar el backup? Lo ya copiado queda guardado y no se repetirá la próxima vez.')) cancel()
          }}
        >
          Cancelar
        </Button>
      </div>
    </>
  )
}
