import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

type Pref = 'system' | 'light' | 'dark'

function read(): Pref {
  try {
    return (localStorage.getItem('theme') as Pref) || 'system'
  } catch {
    return 'system'
  }
}

function apply(pref: Pref) {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

const OPTIONS: Array<{ id: Pref; label: string; icon: typeof Sun }> = [
  { id: 'system', label: 'Según el sistema', icon: Monitor },
  { id: 'light', label: 'Claro', icon: Sun },
  { id: 'dark', label: 'Oscuro', icon: Moon },
]

/** Tema claro / oscuro / según el sistema (se recuerda en este navegador). */
export function ThemeSwitch({ compact }: { compact?: boolean }) {
  const [pref, setPref] = useState<Pref>(read)

  useEffect(() => {
    apply(pref)
    try {
      localStorage.setItem('theme', pref)
    } catch {
      // modo privado: solo para esta sesión
    }
    if (pref !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => apply('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [pref])

  if (compact) {
    const next = OPTIONS[(OPTIONS.findIndex((o) => o.id === pref) + 1) % OPTIONS.length]
    const Current = OPTIONS.find((o) => o.id === pref)!.icon
    return (
      <button className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setPref(next.id)} aria-label={`Tema: ${pref}. Cambiar a ${next.label}`}>
        <Current size={18} />
      </button>
    )
  }

  return (
    <div className="flex rounded-xl border border-line bg-surface-2/60 p-0.5" role="radiogroup" aria-label="Tema">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={pref === o.id}
          title={o.label}
          onClick={() => setPref(o.id)}
          className={`grid h-7 flex-1 place-items-center rounded-lg transition ${pref === o.id ? 'bg-surface text-fg shadow-sm' : 'text-subtle hover:text-fg'}`}
        >
          <o.icon size={15} aria-hidden />
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
