import { RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useApp } from '../state/app'
import { useTools } from '../state/tools'
import { Button } from './ui'

/**
 * Aviso de nueva versión. La app nunca se actualiza sola: el usuario decide,
 * y no se permite mientras haya un backup u otra operación en curso.
 */
export function UpdatePrompt() {
  const running = useApp((s) => s.running)
  const job = useTools((s) => s.job)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Comprobar si hay versión nueva cada hora mientras la app está abierta.
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000)
    },
  })
  useEffect(() => {
    if (!offlineReady) return
    const t = setTimeout(() => setOfflineReady(false), 6000)
    return () => clearTimeout(t)
  }, [offlineReady, setOfflineReady])
  if (!needRefresh && !offlineReady) return null
  const busy = running || !!job

  return (
    <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 lg:right-6 lg:bottom-6 lg:left-auto" role="status">
      <div className="animate-rise flex max-w-md items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm shadow-[var(--shadow-pop)]">
        <RefreshCw size={18} className="shrink-0 text-accent" aria-hidden />
        {needRefresh ? (
          <>
            <p className="flex-1">{busy ? 'Hay una versión nueva. Podrás actualizar cuando termine la operación en curso.' : 'Hay una versión nueva de la app.'}</p>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void updateServiceWorker(true)}>Actualizar</Button>
            <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>Luego</Button>
          </>
        ) : (
          <>
            <p className="flex-1">Lista para funcionar sin conexión.</p>
            <Button size="sm" variant="ghost" onClick={() => setOfflineReady(false)}>Vale</Button>
          </>
        )}
      </div>
    </div>
  )
}
