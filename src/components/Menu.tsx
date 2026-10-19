import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

const WIDTH = 208
const GAP = 6

/**
 * Menú de opciones con la Popover API: se abre al instante (sin estado de
 * React), va en la capa superior (nunca queda recortado por la tarjeta o la
 * lista) y se cierra con un clic fuera, Esc, o al desplazar la página.
 */
export function Menu({ label, disabled, children }: { label: string; disabled?: boolean; children: ReactNode }) {
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const p = pop.current
    if (!p) return
    const close = () => p.hidePopover()
    const place = () => {
      const r = btn.current!.getBoundingClientRect()
      const left = Math.max(8, Math.min(r.right - WIDTH, innerWidth - WIDTH - 8))
      p.style.left = `${left}px`
      p.style.top = `${r.bottom + GAP}px`
      p.style.transformOrigin = 'top right'
    }
    const onBefore = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') {
        place()
        addEventListener('scroll', close, { capture: true, passive: true })
        addEventListener('resize', close)
      } else {
        removeEventListener('scroll', close, { capture: true })
        removeEventListener('resize', close)
      }
    }
    // Si no cabe debajo, se abre hacia arriba.
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== 'open') return
      const h = p.offsetHeight
      const r = btn.current!.getBoundingClientRect()
      if (r.bottom + GAP + h > innerHeight - 8 && r.top - GAP - h > 8) {
        p.style.top = `${r.top - GAP - h}px`
        p.style.transformOrigin = 'bottom right'
      }
      p.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    }
    p.addEventListener('beforetoggle', onBefore)
    p.addEventListener('toggle', onToggle)
    return () => {
      p.removeEventListener('beforetoggle', onBefore)
      p.removeEventListener('toggle', onToggle)
      removeEventListener('scroll', close, { capture: true })
      removeEventListener('resize', close)
    }
  }, [])

  // Flechas arriba/abajo para moverse entre opciones.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...pop.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        popoverTarget={id}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
        aria-label={label}
        aria-haspopup="menu"
        disabled={disabled}
      >
        <MoreHorizontal size={18} aria-hidden />
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        role="menu"
        onKeyDown={onKeyDown}
        style={{ width: WIDTH }}
        className="menu-pop rounded-xl border border-line bg-surface p-1 text-fg shadow-[var(--shadow-pop)]"
      >
        {children}
      </div>
    </>
  )
}

export function MenuItem({ icon: Icon, danger, onSelect, children }: { icon?: LucideIcon; danger?: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-surface-2 focus-visible:bg-surface-2 ${danger ? 'text-danger' : ''}`}
      onClick={(e) => {
        e.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
        onSelect()
      }}
    >
      {Icon && <Icon size={15} aria-hidden />}
      {children}
    </button>
  )
}
