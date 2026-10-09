import { useApp } from '../state/app'

/** "Disco conectado: X" / "Ningún disco conectado", actualizado cada 3 s. */
export function DiskBadge({ large }: { large?: boolean }) {
  const s = useApp((st) => st.diskStatus)
  if (s.state === 'none') return null
  const [dot, text] =
    s.state === 'connected'
      ? ['bg-emerald-500', `Disco conectado: ${s.name}`]
      : s.state === 'needs-permission'
        ? ['bg-amber-500', 'Hay que permitir el acceso al disco']
        : ['bg-slate-400', 'Ningún disco conectado']
  return (
    <span className={`inline-flex items-center gap-2 ${large ? 'text-base font-medium' : 'text-xs text-slate-600 dark:text-slate-300'}`} role="status">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
      {text}
    </span>
  )
}
