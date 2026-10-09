import type { DiskStatus } from '../platform/disk-monitor'
import { useApp } from '../state/app'

export function statusLabel(s: DiskStatus | undefined, name: string): [dot: string, text: string] {
  if (s?.state === 'connected') return ['bg-emerald-500', `Disco conectado: ${s.name}`]
  if (s?.state === 'needs-permission') return ['bg-amber-500', `${name}: hay que permitir el acceso`]
  if (!s) return ['bg-slate-300', `${name}: comprobando…`]
  return ['bg-slate-400', `${name}: no conectado`]
}

/** "Disco conectado: X" / "Ningún disco conectado", actualizado cada 3 s. */
export function DiskBadge() {
  const { disks, diskStates } = useApp()
  if (disks.length === 0) return null
  const connected = disks.filter((d) => diskStates[d.key]?.state === 'connected')
  const [dot, text] = connected.length
    ? ['bg-emerald-500', `Disco conectado: ${connected.map((d) => (diskStates[d.key] as { name: string }).name).join(', ')}`]
    : ['bg-slate-400', 'Ningún disco conectado']
  return (
    <span className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300" role="status">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
      {text}
    </span>
  )
}
