import { HardDrive } from 'lucide-react'
import type { DiskStatus } from '../platform/disk-monitor'
import { useApp } from '../state/app'
import { StatusDot } from './ui'

export function statusLabel(s: DiskStatus | undefined, name: string): [dot: string, text: string] {
  if (s?.state === 'connected') return ['ok', `Disco conectado: ${s.name}`]
  if (s?.state === 'needs-permission') return ['warn', `${name}: hay que permitir el acceso`]
  if (!s) return ['pending', `${name}: comprobando…`]
  return ['off', `${name}: no conectado`]
}

/** "Disco conectado: X" / "Ningún disco conectado", actualizado cada 3 s. */
export function DiskBadge() {
  const { disks, diskStates } = useApp()
  if (disks.length === 0) return null
  const connected = disks.filter((d) => diskStates[d.key]?.state === 'connected')
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3" role="status" aria-live="polite">
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${connected.length ? 'bg-accent-soft text-accent-strong' : 'bg-surface-2 text-subtle'}`}>
        <HardDrive size={17} aria-hidden />
      </span>
      <div className="min-w-0 text-xs">
        <div className="flex items-center gap-1.5 font-medium">
          <StatusDot tone={connected.length ? 'ok' : 'off'} />
          {connected.length ? 'Disco conectado' : 'Ningún disco conectado'}
        </div>
        {connected.length > 0 && <div className="truncate text-muted">{connected.map((d) => (diskStates[d.key] as { name: string }).name).join(', ')}</div>}
      </div>
    </div>
  )
}
