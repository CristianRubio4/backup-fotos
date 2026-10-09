import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from 'lucide-react'
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'

export function Card({ title, icon: Icon, children, actions, className = '', description }: { title?: ReactNode; icon?: LucideIcon; children: ReactNode; actions?: ReactNode; className?: string; description?: ReactNode }) {
  return (
    <section className={`card animate-rise p-4 sm:p-6 ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-strong">
                <Icon size={18} strokeWidth={2.2} aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md' | 'lg' | 'xl'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg shadow-sm hover:bg-accent-strong active:scale-[0.98] disabled:bg-surface-2 disabled:text-subtle disabled:shadow-none',
  secondary: 'border border-line bg-surface text-fg hover:bg-surface-2 active:scale-[0.98] disabled:text-subtle',
  danger: 'bg-danger text-white shadow-sm hover:brightness-110 active:scale-[0.98] disabled:opacity-40',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-xs',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-12 gap-2 rounded-xl px-5 text-[15px]',
  xl: 'h-16 gap-3 rounded-2xl px-6 text-lg',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: LucideIcon }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition duration-150 select-none disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    >
      {Icon && <Icon size={size === 'sm' ? 14 : size === 'xl' ? 22 : 16} strokeWidth={2.2} aria-hidden />}
      {children}
    </button>
  )
}

type Tone = 'info' | 'warn' | 'error' | 'ok'

const TONES: Record<Tone, { cls: string; icon: LucideIcon }> = {
  info: { cls: 'border-sky-500/25 bg-sky-500/8 text-fg [&_svg.tone]:text-sky-500', icon: Info },
  warn: { cls: 'border-warn/35 bg-warn/10 text-fg [&_svg.tone]:text-warn', icon: AlertTriangle },
  error: { cls: 'border-danger/30 bg-danger/8 text-fg [&_svg.tone]:text-danger', icon: XCircle },
  ok: { cls: 'border-ok/30 bg-ok/8 text-fg [&_svg.tone]:text-ok', icon: CheckCircle2 },
}

export function Alert({ tone = 'info', children, onClose }: { tone?: Tone; children: ReactNode; onClose?: () => void }) {
  const t = TONES[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`animate-rise flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${t.cls}`}>
      <t.icon className="tone mt-0.5 shrink-0" size={18} aria-hidden />
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
      {onClose && (
        <button onClick={onClose} className="-m-1 rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Cerrar">
          <X size={16} />
        </button>
      )}
    </div>
  )
}

export function ProgressBar({ value, large, tone = 'accent' }: { value: number; large?: boolean; tone?: 'accent' | 'warn' }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div
      className={`relative w-full overflow-hidden rounded-full bg-surface-2 ${large ? 'h-3' : 'h-1.5'}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${tone === 'warn' ? 'bg-warn' : 'bg-accent'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/** Anillo de progreso (pantalla de backup). */
export function ProgressRing({ value, size = 168, children }: { value: number; size?: number; children?: ReactNode }) {
  const pct = Math.max(0, Math.min(100, value))
  const stroke = 12
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset 0.6s var(--ease-out-expo)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}

export function Stat({ label, value, tone, icon: Icon }: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'error' | 'muted'; icon?: LucideIcon }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'error' ? 'text-danger' : 'text-fg'
  return (
    <div className="rounded-2xl border border-line bg-surface-2/60 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {Icon && <Icon size={13} aria-hidden />}
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${color}`}>{value}</div>
    </div>
  )
}

/** Interruptor accesible (role="switch"). */
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{hint}</span>}
      </label>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}

/** Etiqueta pequeña de estado. */
export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'accent' | 'ok' | 'warn' | 'danger' | 'muted' }) {
  const cls = {
    accent: 'bg-accent-soft text-accent-strong',
    ok: 'bg-ok/12 text-ok',
    warn: 'bg-warn/15 text-warn',
    danger: 'bg-danger/12 text-danger',
    muted: 'bg-surface-2 text-muted',
  }[tone]
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
}

/** Punto de estado animado (disco conectado, etc.). */
export function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'off' | 'pending' }) {
  const cls = { ok: 'bg-ok', warn: 'bg-warn', off: 'bg-subtle', pending: 'bg-line' }[tone]
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden>
      {tone === 'ok' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-40" />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${cls}`} />
    </span>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className}`} aria-hidden />
}

/** Cabecera de pantalla. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}
