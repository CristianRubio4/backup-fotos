import { AlertTriangle, Cable, Check, Download, FolderPlus, Loader2, FolderOpen, HardDrive, HardDriveDownload, Images, Lock, Pencil, Plus, ShieldCheck, Smartphone, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Dialog } from '../components/Dialog'
import { statusLabel } from '../components/DiskBadge'
import { Menu, MenuItem } from '../components/Menu'
import { Alert, Badge, Button, Card, PageHeader, StatusDot } from '../components/ui'
import { UnlockDisk } from '../components/UnlockDisk'
import { daysSince, formatBytes, formatDateTime, plural } from '../core/format'
import type { DiskRecord } from '../db'
import { CONNECTOR_DOWNLOAD } from '../platform/connector'
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

function DiskMenu({ disk, canUse, active }: { disk: DiskRecord; canUse: boolean; active: boolean }) {
  const { running, renameDisk, removeDisk, setActiveDisk } = useApp()
  const [dialog, setDialog] = useState<'rename' | 'forget' | null>(null)
  const close = () => setDialog(null)
  return (
    <>
      <Menu label={`Opciones de ${disk.name}`} disabled={running}>
        {canUse && !active && (
          <MenuItem icon={Check} onSelect={() => void setActiveDisk(disk.key)}>
            Usar como destino
          </MenuItem>
        )}
        <MenuItem icon={Pencil} onSelect={() => setDialog('rename')}>
          Renombrar
        </MenuItem>
        <MenuItem icon={Trash2} danger onSelect={() => setDialog('forget')}>
          Olvidar en esta app
        </MenuItem>
      </Menu>

      <Dialog open={dialog === 'rename'} onClose={close} title="Renombrar disco">
        <form
          className="p-5"
          onSubmit={(e) => {
            e.preventDefault()
            const n = String(new FormData(e.currentTarget).get('name') ?? '').trim()
            if (n && n !== disk.name) void renameDisk(disk.key, n)
            close()
          }}
        >
          <h2 className="text-lg font-semibold tracking-tight">Renombrar disco</h2>
          <p className="mt-1 text-sm text-muted">El nombre se guarda también en el propio disco, así lo reconocerás en cualquier equipo.</p>
          <input name="name" className="field mt-4 w-full" defaultValue={disk.name} maxLength={60} autoFocus required onFocus={(e) => e.currentTarget.select()} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Cancelar</Button>
            <Button variant="primary" type="submit">Guardar</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === 'forget'} onClose={close} title="Olvidar disco">
        <div className="p-5">
          <h2 className="text-lg font-semibold tracking-tight">¿Olvidar "{disk.name}"?</h2>
          <p className="mt-1 text-sm text-muted">Deja de aparecer en esta app. <b>No se borra nada del disco</b>: puedes volver a añadirlo cuando quieras y la app lo reconocerá.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={close} autoFocus>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                close()
                void removeDisk(disk.key)
              }}
            >
              Olvidar
            </Button>
          </div>
        </div>
      </Dialog>
    </>
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
    <li className={`rounded-2xl border p-3 transition ${active ? 'border-accent/50 bg-accent-soft/40' : 'border-line'}`}>
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
        <DiskMenu disk={disk} active={active} canUse={status?.state === 'connected'} />
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

/** Mientras haga falta, comprueba cada pocos segundos si BackupFotos.exe está abierto y qué móviles ve. */
function useConnectorPolling(active: boolean, ms: number) {
  const refreshConnector = useApp((s) => s.refreshConnector)
  useEffect(() => {
    if (!active) return
    let alive = true
    const tick = async () => {
      if (alive && document.visibilityState === 'visible') await refreshConnector()
    }
    void tick()
    const id = setInterval(tick, ms)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [active, ms, refreshConnector])
}

/** Un móvil por cable elegido como origen. */
function CableRow({ id, name }: { id: string; name: string }) {
  const { running, connector, removeCableDevice } = useApp()
  const seen = connector?.some((d) => d.id === id)
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line p-3">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${seen ? 'bg-accent-soft text-accent-strong' : 'bg-surface-2 text-muted'}`}>
        <Smartphone size={18} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <StatusDot tone={seen ? 'ok' : connector ? 'warn' : 'off'} />
          {seen
            ? 'Conectado por cable · se copiarán todas sus carpetas'
            : connector
              ? 'No conectado: conéctalo, desbloquéalo y elige "Transferencia de archivos"'
              : 'Abre BackupFotos.exe para leerlo'}
        </div>
      </div>
      <Button size="sm" variant="ghost" disabled={running} onClick={() => void removeCableDevice(id)}>Quitar</Button>
    </li>
  )
}

/** Guía para conectar el móvil por cable a través del programa, y lista de móviles que ve. */
function CablePanel() {
  const { connector, cableDevices, addCableDevice } = useApp()
  useConnectorPolling(true, 2000)
  return (
    <div className="animate-rise mt-2 space-y-3 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed">
      {connector === null ? (
        <>
          <p>
            Windows no deja que una web recorra un móvil conectado por cable. Para eso está <b>BackupFotos.exe</b>: un programa pequeño que{' '}
            <b>no se instala</b>. Mientras esté abierto, esta web lee todas las carpetas del móvil a través de él (solo en este PC).
          </p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              <a className="font-medium text-accent-strong underline" href={CONNECTOR_DOWNLOAD}>
                Descarga BackupFotos.exe
              </a>{' '}
              (solo la primera vez) y ábrelo con doble clic. Si Windows avisa de que es desconocido: Más información → Ejecutar de todas formas.
            </li>
            <li>Conecta el móvil por cable y desbloquéalo. En Android elige "Transferencia de archivos"; en iPhone, pulsa "Confiar".</li>
            <li>Si el navegador pregunta si esta web puede acceder a dispositivos de tu red local, pulsa <b>Permitir</b> (es el programa, en este mismo PC).</li>
          </ol>
          <p className="flex items-center gap-2 text-muted">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Esperando al programa…
          </p>
        </>
      ) : connector.length === 0 ? (
        <p className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" aria-hidden /> El programa está abierto, pero no ve ningún móvil. Conéctalo por cable, desbloquéalo y elige
          "Transferencia de archivos" (en iPhone, "Confiar").
        </p>
      ) : (
        <>
          <p>
            El programa ve estos móviles (por cable, o por wifi con <b>Enlace móvil</b>). Añade el tuyo: se copiarán <b>todas</b> sus carpetas
            (cámara, capturas, WhatsApp, tarjeta SD…). Por cable es más rápido y fiable.
          </p>
          <ul className="space-y-2">
            {connector.map((d) => {
              const added = cableDevices.some((c) => c.id === d.id)
              return (
                <li key={d.id} className="flex items-center gap-3 rounded-xl bg-surface p-2.5">
                  <Smartphone size={16} className="shrink-0 text-accent-strong" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.name}</span>
                  {added ? (
                    <Badge tone="accent">Añadido</Badge>
                  ) : (
                    <Button size="sm" variant="primary" icon={Plus} onClick={() => void addCableDevice(d)}>Añadir</Button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
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
  const { sources, disks, diskStates, settings, running, addSource, addDisk, start, go, pickedFiles, addPickedFiles, clearPickedFiles, cableDevices, pendingRun, discardPendingRun } = useApp()
  useKeys()
  const [showTips, setShowTips] = useState(false)
  const [showPhone, setShowPhone] = useState(false)
  const [showCable, setShowCable] = useState(false)
  // Con un móvil por cable añadido, se comprueba de vez en cuando si el programa está abierto.
  useConnectorPolling(cableDevices.length > 0 && !showCable && !running, 5000)

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

  const sourcesReady = pickedFiles.length > 0 || cableDevices.length > 0 || (sources.length > 0 && sources.some((s) => s.perm !== 'denied'))
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
                  {sources.length} {sources.length === 1 ? 'carpeta' : 'carpetas'} de origen ·{' '}
                  {settings.runFolder && !disk!.encrypted ? 'se guarda en una carpeta "móvil - fecha y hora"' : 'solo se copia lo nuevo'} · cada copia se verifica
                </p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-semibold tracking-tight">Prepara tu primer backup</h2>
                <ol className="mt-3 space-y-2">
                  <Step done={disks.length > 0}>Elige dónde guardar: un disco externo o una carpeta de este equipo</Step>
                  <Step done={sources.length > 0 || pickedFiles.length > 0 || cableDevices.length > 0}>Añade tu móvil por cable o las carpetas con tus fotos</Step>
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

      {pendingRun && !running && pendingRun.diskKey === disk?.key && (
        <Alert tone="warn">
          <p className="font-medium">La copia «{pendingRun.folder}» se quedó a medias ({plural(pendingRun.copied, 'archivo copiado', 'archivos copiados')}).</p>
          <p className="mt-1">Puedes continuarla en la misma carpeta: lo ya copiado se salta al instante, sin volver a leerlo.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" icon={HardDriveDownload} disabled={!ready} onClick={() => void start(undefined, pendingRun.folder)}>
              Continuar la copia
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void discardPendingRun()}>
              No, empezar de cero la próxima vez
            </Button>
          </div>
        </Alert>
      )}

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
          {sources.length === 0 && pickedFiles.length === 0 && cableDevices.length === 0 ? (
            <button onClick={addSource} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line p-6 text-center text-sm text-muted transition hover:border-accent hover:text-fg">
              <FolderPlus size={24} aria-hidden />
              Elige una carpeta con fotos y vídeos
              <span className="text-xs">Puede ser una carpeta concreta o un disco o móvil entero: la app busca las fotos en todas las subcarpetas</span>
            </button>
          ) : (
            <ul className="space-y-2">
              {cableDevices.map((c) => (
                <CableRow key={c.id} id={c.id} name={c.name} />
              ))}
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
            {!isAndroid && (
              <button
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium ${showCable ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line bg-surface hover:bg-surface-2'}`}
                onClick={() => setShowCable(!showCable)}
                aria-expanded={showCable}
                disabled={running}
              >
                <Cable size={14} aria-hidden /> Móvil por cable
              </button>
            )}
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
          {showCable && <CablePanel />}
          {showPhone && (
            <div className="animate-rise mt-2 space-y-2 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed">
              <a
                href="https://github.com/CristianRubio4/backup-fotos/releases/latest/download/BackupFotos.exe"
                className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft/50 p-3 text-sm hover:bg-accent-soft"
              >
                <Download size={18} className="shrink-0 text-accent-strong" aria-hidden />
                <span>
                  <b>Recomendado: botón "Móvil por cable".</b> Con BackupFotos.exe abierto (no se instala: descárgalo aquí y ábrelo), esta web lee
                  TODAS las carpetas del móvil y crea la carpeta "móvil - fecha y hora" con todo.
                </span>
              </a>
              <p>
                Desde esta web, Windows no deja recorrer un móvil conectado por cable (lo trata como "dispositivo portátil", no como un disco).
                Si no quieres usar el programa:
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
              <p className="text-muted">
                <b>¿Windows dice "Enlace a Windows está desactivado"?</b> Aunque esté por cable, Windows no deja que un navegador abra el móvil
                como carpeta. Usa <b>Elegir fotos sueltas</b>: esa ventana sí entra en el móvil. La carpeta del backup se llamará con el nombre del
                móvil y la fecha y hora.
              </p>
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
