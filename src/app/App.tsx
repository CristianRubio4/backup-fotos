import { CircleHelp, Compass, HardDriveDownload, History, Home, Settings, ShieldCheck, Wrench, X, type LucideIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { DiskBadge } from '../components/DiskBadge'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { UpdatePrompt } from '../components/UpdatePrompt'
import { Skeleton } from '../components/ui'
import { capabilities } from '../platform/capabilities'
import { HomeScreen } from '../screens/Home'
import { ProgressScreen } from '../screens/Progress'
import { useApp, type Screen } from '../state/app'
import { useTools } from '../state/tools'

// Pantallas cargadas bajo demanda: la de inicio aparece al instante.
const ReportScreen = lazy(() => import('../screens/Report').then((m) => ({ default: m.ReportScreen })))
const ExploreScreen = lazy(() => import('../screens/Explore').then((m) => ({ default: m.ExploreScreen })))
const ToolsScreen = lazy(() => import('../screens/Tools').then((m) => ({ default: m.ToolsScreen })))
const HistoryScreen = lazy(() => import('../screens/History').then((m) => ({ default: m.HistoryScreen })))
const SettingsScreen = lazy(() => import('../screens/Settings').then((m) => ({ default: m.SettingsScreen })))
const HelpScreen = lazy(() => import('../screens/Help').then((m) => ({ default: m.HelpScreen })))
const CompatScreen = lazy(() => import('../screens/Compat').then((m) => ({ default: m.CompatScreen })))

interface NavItem {
  id: Screen
  label: string
  icon: LucideIcon
  full?: boolean // solo en el modo completo (File System Access)
}

const NAV: NavItem[] = [
  { id: 'home', label: 'Inicio', icon: Home },
  { id: 'explore', label: 'Explorar', icon: Compass, full: true },
  { id: 'tools', label: 'Herramientas', icon: Wrench, full: true },
  { id: 'history', label: 'Historial', icon: History },
  { id: 'settings', label: 'Ajustes', icon: Settings },
  { id: 'help', label: 'Ayuda', icon: CircleHelp },
]

const items = NAV.filter((n) => !n.full || capabilities.fsAccess)

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">Backup de fotos</div>
        <div className="text-[11px] text-muted">Tus fotos, a salvo y en local</div>
      </div>
    </div>
  )
}

/** Indicador del backup u operación en curso, visible desde cualquier pantalla. */
function RunningPill() {
  const { running, progress, paused, go } = useApp()
  const job = useTools((s) => s.job)
  if (!running && !job) return null
  const pct = running && progress && progress.totalBytes > 0 ? Math.floor((progress.doneBytes / progress.totalBytes) * 100) : null
  return (
    <button
      onClick={() => go(running ? 'progress' : 'tools')}
      className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow-sm"
    >
      <HardDriveDownload size={14} className={paused ? '' : 'animate-pulse'} aria-hidden />
      {running ? (paused ? 'En pausa' : `Backup ${pct ?? 0} %`) : job!.label}
    </button>
  )
}

function Toast() {
  const { notice, dismissNotice } = useApp()
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(dismissNotice, 9000)
    return () => clearTimeout(t)
  }, [notice, dismissNotice])
  if (!notice) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6" role="alert">
      <div className="animate-rise pointer-events-auto flex max-w-lg items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm shadow-[var(--shadow-pop)]">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
        <p className="flex-1">{notice}</p>
        <button onClick={dismissNotice} className="-m-1 rounded-lg p-1 text-muted hover:bg-surface-2" aria-label="Cerrar aviso">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

function NavLink({ item, active, onClick, mobile }: { item: NavItem; active: boolean; onClick: () => void; mobile?: boolean }) {
  const Icon = item.icon
  if (mobile) {
    return (
      <button onClick={onClick} aria-current={active ? 'page' : undefined} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition ${active ? 'text-accent-strong' : 'text-subtle'}`}>
        <span className={`grid h-7 w-12 place-items-center rounded-full transition ${active ? 'bg-accent-soft' : ''}`}>
          <Icon size={19} strokeWidth={active ? 2.4 : 2} aria-hidden />
        </span>
        {item.label}
      </button>
    )
  }
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-surface-2 hover:text-fg'}`}
    >
      <Icon size={18} strokeWidth={active ? 2.4 : 2} aria-hidden />
      {item.label}
    </button>
  )
}

function Fallback() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40" />
      <Skeleton className="h-28" />
    </div>
  )
}

export function App() {
  const { ready, screen, running, report, init, go } = useApp()

  useEffect(() => {
    void init()
  }, [init])

  // Precarga el resto de pantallas cuando el navegador está libre: la navegación es instantánea.
  useEffect(() => {
    if (!ready) return
    const load = () => {
      for (const m of [() => import('../screens/Report'), () => import('../screens/Explore'), () => import('../screens/Tools'), () => import('../screens/History'), () => import('../screens/Settings'), () => import('../screens/Help')]) void m()
      if (!capabilities.fsAccess) void import('../screens/Compat')
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(load)
    else setTimeout(load, 1500)
  }, [ready])

  const current = screen === 'progress' || screen === 'report' ? 'home' : screen
  const navigate = (id: Screen) => go(id === 'home' && running ? 'progress' : id)

  let content: ReactNode
  if (!ready) content = <Fallback />
  else if (screen === 'home') content = capabilities.fsAccess ? <HomeScreen /> : <CompatScreen />
  else if (screen === 'progress') content = <ProgressScreen />
  else if (screen === 'report') content = <ReportScreen />
  else if (screen === 'explore') content = <ExploreScreen />
  else if (screen === 'tools') content = <ToolsScreen />
  else if (screen === 'history') content = <HistoryScreen />
  else if (screen === 'settings') content = <SettingsScreen />
  else content = <HelpScreen />

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      {/* Barra lateral (escritorio) */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-surface/70 p-5 backdrop-blur-xl lg:flex">
        <Logo />
        <nav className="flex flex-col gap-1" aria-label="Principal">
          {items.map((n) => (
            <NavLink key={n.id} item={n} active={current === n.id} onClick={() => navigate(n.id)} />
          ))}
          {!running && report && <NavLink item={{ id: 'report', label: 'Último informe', icon: ShieldCheck }} active={screen === 'report'} onClick={() => go('report')} />}
        </nav>
        <div className="mt-auto space-y-3">
          <DiskBadge />
          <ThemeSwitch />
          <p className="flex items-center gap-1.5 text-[11px] text-subtle">
            <ShieldCheck size={13} aria-hidden /> Todo ocurre en este dispositivo
          </p>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        {/* Barra superior (móvil) */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur-xl lg:hidden" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
          <Logo />
          <div className="flex items-center gap-1">
            <RunningPill />
            <button className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg" onClick={() => go('help')} aria-label="Ayuda">
              <CircleHelp size={18} />
            </button>
            <ThemeSwitch compact />
          </div>
        </header>

        <div className="hidden items-center justify-end gap-3 px-8 pt-6 lg:flex">
          <RunningPill />
        </div>

        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pb-12" style={{ viewTransitionName: 'main' }}>
          <Suspense fallback={<Fallback />}>{content}</Suspense>
        </main>

        {/* Pestañas (móvil) */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/85 backdrop-blur-xl lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Principal">
          {items
            .filter((n) => n.id !== 'help')
            .map((n) => (
              <NavLink key={n.id} item={n} active={current === n.id} onClick={() => navigate(n.id)} mobile />
            ))}
        </nav>
      </div>

      <Toast />
      <UpdatePrompt />
    </div>
  )
}
