import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Diálogo modal con <dialog> nativo: foco atrapado, Esc para cerrar y clic
 * fuera para cancelar. Sustituye a prompt()/confirm(), que bloquean la página.
 */
export function Dialog({ open, onClose, title, children, className = 'dialog' }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && children}
    </dialog>
  )
}
