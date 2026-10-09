import { AlertTriangle, Check, FolderPlus, FolderOpen, HardDrive, HardDriveDownload, Images, Lock, MoreHorizontal, Plus, ShieldCheck, Smartphone } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { statusLabel } from '../components/DiskBadge'
import { Alert, Badge, Button, Card, PageHeader, StatusDot } from '../components/ui'
import { UnlockDisk } from '../components/UnlockDisk'
import { daysSince, formatBytes, formatDateTime, plural } from '../core/format'
import type { DiskRecord } from '../db'
import { activeDisk, useApp, type SourceView } from '../state/app'
import { isLocked, useKeys } from '../state/keys'

const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

const ANDROID_FOLDERS: Array<[string, string]> = [
  ['Cámara', 'DCIM → Camera'],
  ['Capturas de pantalla', 'Pictures → Screenshots (en algunos móviles: DCIM → Screenshots)'],
  ['WhatsApp', 'Android → media → com.whatsapp → WhatsApp → Media (en móviles antiguos: WhatsApp → Media)'],
  ['Telegram', 'Pictures → Telegram, o Android → media → org.telegram.messenger → Telegram'],
  ['Descargas', 'Download (Android no deja elegir su raíz: elige una subcarpeta)'],
]

function ago(iso: string) {
  const d = daysSince(iso)
  return d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`
}

function DiskMenu({ disk }: { disk: DiskRecord }) {
  const { running, renameDisk, removeDisk } = useApp()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Opciones de ${disk.name}`} aria-expanded={open} onClick={() => setOpen(!open)} disabled={running}>
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="animate-rise absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]" onMouseLeave={() => setOpen(false)}>
          <button
            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
            onClick={() => {
              setOpen(false)
              const n = prompt('Nuevo nombre del disco', disk.name)
              if (n) void renameDisk(disk.key, n)
            }}
          >
            Renombrar
          </button>
          <button
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-surface-2"
            onClick={() => {
              setOpen(false)
              if (confirm(`¿Olvidar "${disk.name}" en esta app? No se borra nada del disco; podrás volver a añadirlo.`)) void removeDisk(disk.key)
            }}
          >
            Olvidar en esta app
          </button>
        </div>
      )}
    </div>
  )
}

function DiskRow({ disk, active, showUse }: { disk: DiskRecord; active: boolean; showUse: boolean }) {
  const { diskStates, settings, setActiveDisk, grantDisk } = useApp()
  useKeys()
  const status = diskStates[disk.key]
  const [, text] = statusLabel(status, disk.name)
  const days = disk.lastBackupAt ? daysSince(disk.lastBackupAt) : null
  const stale = days === null || days > settings.staleDays
  const tone = status?.state === 'connected' ? 'ok' : status?.state === 'needs-permission' ? 'warn' : status ? 'off' : 'pending'

  return (
    <li className={`cv-auto rounded-2xl border p-3 transition ${active ? 'border-accent/50 bg-accent-soft/40' : 'border-line'}`}>
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${status?.state === 'connected' ? 'bg-accent-soft text-accent-strong' : 'bg-surface-2 text-subtle'}`}>
          {disk.encrypted ? <Lock size={18} aria-hidden /> : <HardDrive size={18} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{disk.name}</span>
            {active && <Badge tone="accent">Destino</Badge>}
            {disk.encrypted && <Badge>{isLocked(disk) ? 'Cifrado · bloqueado' : 'Cifrado'}</Badge>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={tone} /> {status?.state === 'connected' ? 'Conectado' : text.replace(`${disk.name}: `, '')}
            </span>
            <span className={stale ? 'text-warn' : ''}>{disk.lastBackupAt ? `Último backup ${ago(disk.lastBackupAt)}` : 'Sin backups todavía'}</span>
          </div>
        </div>
        {status?.state === 'needs-permission' && <Button size="sm" variant="primary" onClick={() => grantDisk(disk.key)}>Permitir</Button>}
        {showUse && !active && status?.state === 'connected' && <Button size="sm" onClick={() => setActiveDisk(disk.key)}>Usar este</Button>}
        <DiskMenu disk={disk} />
      </div>
      {disk.encrypted && status?.state === 'connected' && isLocked(disk) && <UnlockDisk disk={disk} />}
    </li>
  )
}

function SourceRow({ s }: { s: SourceView }) {
  const { running, grantSource, removeSource } = useApp()
  return (
    <li className="cv-auto flex items-center gap-3 rounded-2xl border border-line p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
        <FolderOpen size={18} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{s.name}</div>
        <div className="text-xs text-muted">
          {s.perm === 'granted' ? 'Con acceso · incluye subcarpetas' : s.perm === 'prompt' ? 'Se pedirá permiso al empezar' : 'Acceso denegado: quítala y vuelve a añadirla'}
        </div>
      </div>
      {s.perm === 'prompt' && <Button size="sm" onClick={() => grantSource(s.key)}>Permitir</Button>}
      <Button size="sm" variant="ghost" disabled={running} onClick={() => removeSource(s.key)}>Quitar</Button>
    </li>
  )
}

function Step({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${done ? 'bg-ok text-white' : 'border border-line text-subtle'}`}>{done ? <Check size={14} strokeWidth={3} /> : null}</span>
      <span className={done ? 'text-muted line-through decoration-line' : ''}>{children}</span>
    </li>
  )
}

export function HomeScreen() {
  const { sources, disks, diskStates, settings, running, addSource, addDisk, start, go, pickedFiles, addPickedFiles, clearPickedFiles } = useApp()
  useKeys()
  const [showTips, setShowTips] = useState(false)
  const [showPhone, setShowPhone] = useState(false)

  const disk = activeDisk()
  const connectedCount = disks.filter((d) => diskStates[d.key]?.state === 'connected').length
  const lastBackup = disks.map((d) => d.lastBackupAt).filter(Boolean).sort().at(-1)

  const warnings: string[] = []
  for (const d of disks) {
    if (d.lastBackupAt && daysSince(d.lastBackupAt) > settings.staleDays) warnings.push(`"${d.name}" lleva ${daysSince(d.lastBackupAt)} días sin backup.`)
    const checkedDays = d.lastCheckAt ? daysSince(d.lastCheckAt) : d.lastBackupAt ? daysSince(d.addedAt) : 0
    if (checkedDays > settings.integrityMonths * 30) warnings.push(`Toca comprobar la integridad de "${d.name}" (${d.lastCheckAt ? `última vez ${ago(d.lastCheckAt)}` : 'nunca se ha comprobado'}).`)
  }
  if (disks.length === 1) warnings.push('Solo tienes un disco de backup. Lo ideal es rotar dos y guardar uno fuera de casa (regla 3-2-1).')

  const sourcesReady = pickedFiles.length > 0 || (sources.length > 0 && sources.some((s) => s.perm !== 'denied'))
  const locked = !!disk?.encrypted && isLocked(disk)
  const ready = !!disk && sourcesReady && !locked

  return (
    <>
      <PageHeader
        title="Tus fotos, a salvo"
        subtitle={lastBackup ? `Último backup ${ago(lastBackup)} · ${formatDateTime(lastBackup)}` : 'Copia tus fotos y vídeos en un disco externo sin que salgan de tu dispositivo.'}
      />

      {/* Tarjeta principal */}
      <section className="card animate-rise relative overflow-hidden p-5 sm:p-7">
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            {ready ? (
              <>
                <div className="flex items-center gap-2 text-sm font-medium text-ok">
                  <ShieldCheck size={16} aria-hidden /> Todo listo
                </div>
                <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Backup en {disk!.name}</h2>
                <p className="mt-1 text-sm text-muted">
                  {sources.length} {sources.length === 1 ? 'carpeta' : 'carpetas'} de origen · solo se copia lo nuevo · cada copia se verifica
                </p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-semibold tracking-tight">Prepara tu primer backup</h2>
                <ol className="mt-3 space-y-2">
                  <Step done={disks.length > 0}>Elige dónde guardar: un disco externo o una carpeta de este equipo</Step>
                  <Step done={sources.length > 0 || pickedFiles.length > 0}>Añade las carpetas con tus fotos (o elige fotos sueltas)</Step>
                  <Step done={connectedCount > 0}>Conecta el disco (si guardas en uno externo)</Step>
                  {locked && <Step done={false}>Desbloquea el disco cifrado con su contraseña</Step>}
                </ol>
              </>
            )}
          </div>
          {running ? (
            <Button size="xl" variant="primary" icon={HardDriveDownload} onClick={() => go('progress')}>Ver el backup</Button>
          ) : (
            <Button size="xl" variant="primary" icon={HardDriveDownload} disabled={!ready} onClick={() => void start()}>Hacer backup</Button>
          )}
        </div>
      </section>

      {warnings.length > 0 && (
        <Alert tone="warn">
          <ul className="space-y-1">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Card
          title="Dónde guardar"
          icon={HardDrive}
          description={connectedCount ? `${connectedCount} ${connectedCount > 1 ? 'destinos disponibles' : 'destino disponible'}` : 'Disco externo, pendrive o carpeta de este equipo'}
          actions={<Button size="sm" icon={Plus} onClick={addDisk} disabled={running}>Añadir</Button>}
        >
          {disks.length === 0 ? (
            <button onClick={addDisk} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line p-6 text-center text-sm text-muted transition hover:border-accent hover:text-fg">
              <HardDrive size={24} aria-hidden />
              Elige (o crea) la carpeta del backup
              <span className="text-xs">En un disco externo, un pendrive o en este mismo equipo o móvil</span>
            </button>
          ) : (
            <ul className="space-y-2">
              {disks.map((d) => (
                <DiskRow key={d.key} disk={d} active={d.key === disk?.key} showUse={connectedCount > 1} />
              ))}
            </ul>
          )}
          {disks.length > 0 && (
            <p className="mt-3 text-xs text-muted">¿Un disco conectado aparece como no conectado (otra letra en Windows)? Pulsa "Añadir" y elige de nuevo su carpeta: la app lo reconoce.</p>
          )}
        </Card>

        <Card
          title="Fotos que copiar"
          icon={FolderOpen}
          description="Cámara, capturas, WhatsApp, Telegram…"
          actions={<Button size="sm" icon={FolderPlus} onClick={addSource} disabled={running}>Añadir</Button>}
        >
          {sources.length === 0 && pickedFiles.length === 0 ? (
            <button onClick={addSource} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line p-6 text-center text-sm text-muted transition hover:border-accent hover:text-fg">
              <FolderPlus size={24} aria-hidden />
              Elige una carpeta con fotos y vídeos
              <span className="text-xs">Puede ser una carpeta concreta o un disco o móvil entero: la app busca las fotos en todas las subcarpetas</span>
            </button>
          ) : (
            <ul className="space-y-2">
              {sources.map((s) => (
                <SourceRow key={s.key} s={s} />
              ))}
              {pickedFiles.length > 0 && (
                <li className="flex items-center gap-3 rounded-2xl border border-line p-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                    <Images size={18} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">Fotos elegidas</div>
                    <div className="text-xs text-muted">{plural(pickedFiles.length, 'archivo', 'archivos')} · {formatBytes(pickedFiles.reduce((a, f) => a + f.size, 0))} · solo para esta sesión</div>
                  </div>
                  <Button size="sm" variant="ghost" disabled={running} onClick={clearPickedFiles}>Quitar</Button>
                </li>
              )}
            </ul>
          )}

          {/* Alternativa al selector de carpetas: móvil por USB en Windows (MTP), cámaras… */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-medium hover:bg-surface-2 ${running ? 'pointer-events-none opacity-50' : ''}`}>
              <Images size={14} aria-hidden /> Elegir fotos sueltas
              <input
                type="file"
                multiple
                accept="*/*"
                className="sr-only"
                onChange={(e) => {
                  addPickedFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
            {!isAndroid && (
              <button className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-strong" onClick={() => setShowPhone(!showPhone)} aria-expanded={showPhone}>
                <Smartphone size={14} aria-hidden /> ¿Fotos de un móvil conectado por USB?
              </button>
            )}
          </div>
          {showPhone && (
            <div className="animate-rise mt-2 space-y-2 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed">
              <p>
                Al conectar un móvil por cable, Windows lo muestra como "dispositivo portátil", no como un disco normal, y el navegador no siempre
                puede recorrerlo como carpeta. Tienes tres opciones:
              </p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>
                  <b>Añadir carpeta</b> y elegir el móvil (o su almacenamiento interno): la app busca las fotos en todas las subcarpetas. Si da error,
                  prueba la siguiente opción.
                </li>
                <li>
                  <b>Elegir fotos sueltas</b>: en la ventana ve a Este equipo → tu móvil → Almacenamiento interno → DCIM → Camera, pulsa Ctrl + A y
                  Abrir. Repite con otras carpetas (WhatsApp, capturas…) si quieres.
                </li>
                <li>
                  <b>Usar la app en el propio móvil</b> (Chrome en Android): elige DCIM como origen y guarda en un disco conectado por USB-OTG o en una
                  carpeta del móvil.
                </li>
              </ol>
              <p className="text-muted">En el móvil, desbloquéalo y elige "Transferencia de archivos" al conectarlo. En iPhone, usa "Elegir fotos sueltas" o la app Fotos de Windows.</p>
            </div>
          )}
          {isAndroid && (
            <div className="mt-3">
              <button className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-strong" onClick={() => setShowTips(!showTips)} aria-expanded={showTips}>
                <Smartphone size={14} aria-hidden /> ¿Qué carpetas añadir en Android?
              </button>
              {showTips && (
                <div className="animate-rise mt-2 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed">
                  <ul className="space-y-1">
                    {ANDROID_FOLDERS.map(([n, p]) => (
                      <li key={n}>
                        <b>{n}:</b> {p}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 flex gap-1.5 text-muted">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                    Android no deja elegir la raíz del almacenamiento, la carpeta Download entera ni Android/data. Si una carpeta no se puede
                    seleccionar, es una restricción de Android: elige sus subcarpetas.
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-subtle">
        <ShieldCheck size={13} aria-hidden /> Nunca se borra ni se modifica nada en tus carpetas de origen.
      </p>
    </>
  )
}
