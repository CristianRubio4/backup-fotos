import { AlertOctagon, Ban, Check, Copy, Files, Pause, Play, ShieldQuestion, Square, Sun, Unplug } from 'lucide-react'
import { Alert, Button, Card, PageHeader, ProgressRing, Stat } from '../components/ui'
import { PHASES } from '../core/backup/progress'
import { formatBytes, formatDuration } from '../core/format'
import { activeDisk, useApp } from '../state/app'

export function ProgressScreen() {
  const { progress: p, paused, running, pause, resume, cancel, waitReason, batteryPaused, battery, wake, grantDisk } = useApp()
  const disk = activeDisk()
  const diskName = disk?.name ?? 'el disco'

  if (!running) return <p className="text-muted">No hay ningún backup en curso.</p>

  const pct = p && p.totalBytes > 0 ? (p.doneBytes / p.totalBytes) * 100 : 0
  const current = p ? PHASES.findIndex((ph) => ph.id === p.phase) : 0
  const state = p?.waitingDisk ? 'Esperando al disco' : paused ? 'En pausa' : (PHASES[current]?.label ?? 'Preparando')

  return (
    <>
      <PageHeader title="Haciendo backup" subtitle={`En ${diskName} · mantén esta pestaña abierta y el disco conectado`} />

      {p?.waitingDisk && (
        <Alert tone="error">
          {waitReason === 'needs-permission' ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-medium">El disco ha vuelto, pero hay que permitir de nuevo el acceso.</span>
              <Button variant="primary" size="sm" onClick={() => disk && grantDisk(disk.key)}>Permitir acceso al disco</Button>
            </div>
          ) : waitReason === 'other-disk' ? (
            <span className="font-medium">Ese no es el disco de este backup. Conecta "{diskName}".</span>
          ) : (
            <>
              <p className="flex items-center gap-2 font-medium"><Unplug size={16} aria-hidden /> El disco se ha desconectado. El backup está en pausa.</p>
              <p className="mt-1 text-muted">Vuelve a conectar "{diskName}" y continuará solo, sin repetir nada. Si Windows le asigna otra letra, cancela y vuelve a añadir su carpeta: lo ya copiado no se repetirá.</p>
            </>
          )}
        </Alert>
      )}
      {batteryPaused && (
        <Alert tone="warn">
          <p className="font-medium">Pausado: la batería ha bajado del 10 % ({battery ? Math.round(battery.level * 100) : '?'} %).</p>
          <p className="mt-1 text-muted">Conecta el cargador y pulsa Reanudar. Con el disco conectado por OTG el móvil normalmente no se carga, salvo con un hub USB con alimentación.</p>
        </Alert>
      )}

      <section className="card animate-rise p-5 sm:p-7">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <ProgressRing value={pct}>
            <div>
              <div className="text-4xl font-semibold tracking-tight tabular-nums">{Math.floor(pct)}<span className="text-xl text-muted">%</span></div>
              <div className="mt-0.5 text-xs text-muted">{p ? `${formatBytes(p.doneBytes)} de ${formatBytes(p.totalBytes)}` : '…'}</div>
            </div>
          </ProgressRing>
          <div className="w-full min-w-0 flex-1 space-y-4">
            <div>
              <div className="text-lg font-semibold">{state}</div>
              <div className="text-sm text-muted">
                {p?.phase === 'scan' ? `${p.phaseDone} archivos encontrados` : p && p.phaseTotal > 0 ? `${Math.min(p.phaseDone + 1, p.phaseTotal)} de ${p.phaseTotal} archivos` : ''}
              </div>
              {p?.currentFile && <div className="mt-1 truncate font-mono text-xs text-subtle" title={p.currentFile}>{p.currentFile}</div>}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span><span className="text-muted">Velocidad </span><b className="tabular-nums">{p ? `${formatBytes(p.bytesPerSec)}/s` : '—'}</b></span>
              <span><span className="text-muted">Quedan </span><b className="tabular-nums">{formatDuration(p?.etaSec ?? null)}</b></span>
            </div>
            <div className="flex flex-wrap gap-2">
              {paused ? (
                <Button variant="primary" icon={Play} onClick={resume}>Reanudar</Button>
              ) : (
                <Button icon={Pause} onClick={pause}>Pausar</Button>
              )}
              <Button variant="ghost" icon={Square} onClick={() => confirm('¿Cancelar el backup? Lo ya copiado queda guardado y no se repetirá la próxima vez.') && cancel()}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>

        {/* Línea de fases */}
        <ol className="mt-6 grid grid-cols-4 gap-2 sm:grid-cols-8" aria-label="Fases">
          {PHASES.map((ph, i) => {
            const done = i < current
            const now = i === current
            return (
              <li key={ph.id} className="flex flex-col items-center gap-1.5 text-center">
                <span className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold transition ${done ? 'bg-accent text-accent-fg' : now ? 'bg-accent-soft text-accent-strong ring-2 ring-accent' : 'bg-surface-2 text-subtle'}`}>
                  {done ? <Check size={14} strokeWidth={3} /> : i + 1}
                </span>
                <span className={`text-[10px] leading-tight ${now ? 'font-semibold text-fg' : 'text-muted'}`}>{ph.label}</span>
              </li>
            )
          })}
        </ol>
      </section>

      {p && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Copiados" value={p.counters.copied} tone="ok" icon={Copy} />
          <Stat label="Duplicados" value={p.counters.duplicates} icon={Files} />
          <Stat label="Descartados" value={p.counters.discarded} tone={p.counters.discarded ? 'warn' : undefined} icon={Ban} />
          <Stat label="No verificados" value={p.counters.unverified} tone={p.counters.unverified ? 'warn' : undefined} icon={ShieldQuestion} />
          <Stat label="Errores" value={p.counters.errors} tone={p.counters.errors ? 'error' : undefined} icon={AlertOctagon} />
        </div>
      )}

      <Card>
        <p className="flex items-center gap-2 text-sm text-muted">
          <Sun size={16} aria-hidden />
          {wake === 'on'
            ? 'La pantalla se mantendrá encendida hasta que termine.'
            : wake === 'unsupported' || wake === 'failed'
              ? 'Este navegador no puede mantener la pantalla encendida: evita que se bloquee mientras dura el backup.'
              : 'Mantén la pestaña visible para que el backup avance a buen ritmo.'}
        </p>
      </Card>
    </>
  )
}
