import { useEffect, type ButtonHTMLAttributes } from 'react'
import { DiskBadge } from '../components/DiskBadge'
import { Alert } from '../components/ui'
import { HelpScreen } from '../screens/Help'
import { HistoryScreen } from '../screens/History'
import { HomeScreen } from '../screens/Home'
import { ProgressScreen } from '../screens/Progress'
import { ReportScreen } from '../screens/Report'
import { SettingsScreen } from '../screens/Settings'
import { useApp, type Screen } from '../state/app'

const NAV: Array<{ id: Screen; label: string }> = [
  { id: 'home', label: 'Inicio' },
  { id: 'history', label: 'Historial' },
  { id: 'settings', label: 'Ajustes' },
  { id: 'help', label: 'Ayuda' },
]

export function App() {
  const { ready, screen, running, notice, report, init, go, dismissNotice } = useApp()

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <button className="text-lg font-bold tracking-tight" onClick={() => !running && go('home')}>
          📸 Backup de fotos
        </button>
        <nav className="flex flex-wrap gap-1 text-sm">
          {running && (
            <NavButton active={screen === 'progress'} onClick={() => go('progress')}>
              Progreso
            </NavButton>
          )}
          {!running && report && (
            <NavButton active={screen === 'report'} onClick={() => go('report')}>
              Informe
            </NavButton>
          )}
          {NAV.map((n) => (
            <NavButton key={n.id} active={screen === n.id} onClick={() => go(n.id)} disabled={running && n.id === 'settings'}>
              {n.label}
            </NavButton>
          ))}
        </nav>
      </header>

      {screen !== 'home' && (
        <div className="-mt-2 mb-3">
          <DiskBadge />
        </div>
      )}

      {notice && (
        <div className="mb-4">
          <Alert tone="error" onClose={dismissNotice}>
            {notice}
          </Alert>
        </div>
      )}

      <main className="flex flex-1 flex-col gap-4">
        {!ready ? (
          <p className="text-slate-500">Cargando…</p>
        ) : screen === 'home' ? (
          <HomeScreen />
        ) : screen === 'progress' ? (
          <ProgressScreen />
        ) : screen === 'report' ? (
          <ReportScreen />
        ) : screen === 'history' ? (
          <HistoryScreen />
        ) : screen === 'settings' ? (
          <SettingsScreen />
        ) : (
          <HelpScreen />
        )}
      </main>

      <footer className="pt-8 text-center text-xs text-slate-400">
        Todo ocurre en este dispositivo: ninguna foto ni dato sale de él.
      </footer>
    </div>
  )
}

function NavButton({ active, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      {...props}
      className={`rounded-lg px-3 py-1.5 disabled:opacity-40 ${
        active ? 'bg-slate-200 font-medium dark:bg-slate-800' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
      }`}
    />
  )
}
