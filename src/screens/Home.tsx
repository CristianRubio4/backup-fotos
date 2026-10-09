import { useState } from 'react'
import { statusLabel } from '../components/DiskBadge'
import { Alert, Button, Card } from '../components/ui'
import { UnlockDisk } from '../components/UnlockDisk'
import { daysSince, formatDateTime } from '../core/format'
import type { DiskRecord } from '../db'
import { capabilities } from '../platform/capabilities'
import { activeDisk, useApp } from '../state/app'
import { isLocked, useKeys } from '../state/keys'

const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

const ANDROID_FOLDERS: Array<[string, string]> = [
  ['Cámara', 'DCIM → Camera'],
  ['Capturas de pantalla', 'Pictures → Screenshots (en algunos móviles: DCIM → Screenshots)'],
  ['WhatsApp', 'Android → media → com.whatsapp → WhatsApp → Media (en móviles antiguos: WhatsApp → Media)'],
  ['Telegram', 'Pictures → Telegram, o Android → media → org.telegram.messenger → Telegram'],
  ['Descargas', 'Download (Android no deja elegir su raíz: elige una subcarpeta)'],
]

function DiskRow({ disk, active, showUse }: { disk: DiskRecord; active: boolean; showUse: boolean }) {
  const { diskStates, settings, running, setActiveDisk, grantDisk, renameDisk, removeDisk } = useApp()
  useKeys()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(disk.name)
  const status = diskStates[disk.key]
  const [dot, text] = statusLabel(status, disk.name)
  const days = disk.lastBackupAt ? daysSince(disk.lastBackupAt) : null
  const stale = days === null || days > settings.staleDays

  return (
    <li className={`rounded-xl border p-3 ${active ? 'border-emerald-400 dark:border-emerald-700' : 'border-slate-200 dark:border-slate-800'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          {editing ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void renameDisk(disk.key, name).then(() => setEditing(false))
              }}
            >
              <input className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} />
              <Button type="submit" className="px-2 py-1 text-xs">Guardar</Button>
            </form>
          ) : (
            <p className="font-medium">
              💽 {disk.name} {disk.encrypted && <span title="Disco cifrado">🔒</span>}
              {active && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">destino</span>}
            </p>
          )}
          <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden /> {status?.state === 'connected' ? 'Conectado' : text.replace(`${disk.name}: `, '')}
          </p>
          <p className={`text-xs ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
            {disk.lastBackupAt ? `Último backup: ${formatDateTime(disk.lastBackupAt)} (hace ${days} días)` : 'Todavía sin backups desde esta app'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {status?.state === 'needs-permission' && (
            <Button variant="primary" className="px-3 py-1 text-xs" onClick={() => grantDisk(disk.key)}>
              Permitir acceso al disco
            </Button>
          )}
          {showUse && !active && status?.state === 'connected' && (
            <Button className="px-3 py-1 text-xs" onClick={() => setActiveDisk(disk.key)}>Usar este</Button>
          )}
          {!editing && <Button variant="ghost" className="px-2 py-1 text-xs" disabled={running} onClick={() => setEditing(true)}>Renombrar</Button>}
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs"
            disabled={running}
            onClick={() => confirm(`¿Olvidar "${disk.name}" en esta app? No se borra nada del disco; podrás volver a añadirlo.`) && removeDisk(disk.key)}
          >
            Olvidar
          </Button>
        </div>
      </div>
      {disk.encrypted && status?.state === 'connected' && isLocked(disk) && <UnlockDisk disk={disk} />}
    </li>
  )
}

export function HomeScreen() {
  const { sources, disks, diskStates, settings, running, addSource, removeSource, grantSource, addDisk, start, go } = useApp()
  useKeys()
  const [showTips, setShowTips] = useState(false)

  if (!capabilities.fsAccess) {
    return (
      <Alert tone="warn">
        <p className="font-medium">Este navegador no permite escribir directamente en un disco.</p>
        <p className="mt-1">
          Usa el <b>modo compatible</b>: eliges las fotos, la app las analiza y prepara archivos ZIP que guardas tú en el disco.
        </p>
        <Button variant="primary" className="mt-2" onClick={() => go('home')}>Abrir el modo compatible</Button>
      </Alert>
    )
  }

  const disk = activeDisk()
  const connectedCount = disks.filter((d) => diskStates[d.key]?.state === 'connected').length

  // Avisos pendientes
  const warnings: string[] = []
  for (const d of disks) {
    if (!d.lastBackupAt) continue
    const days = daysSince(d.lastBackupAt)
    if (days > settings.staleDays) warnings.push(`"${d.name}" lleva ${days} días sin backup.`)
    const checkedDays = d.lastCheckAt ? daysSince(d.lastCheckAt) : daysSince(d.addedAt)
    if (checkedDays > settings.integrityMonths * 30) {
      warnings.push(`Toca comprobar la integridad de "${d.name}" (${d.lastCheckAt ? `última comprobación hace ${checkedDays} días` : 'nunca se ha comprobado'}). Herramientas → Comprobar disco.`)
    }
  }
  if (disks.length === 1) warnings.push('Solo tienes un disco de backup. Lo ideal es rotar dos y guardar uno fuera de casa (regla 3-2-1, ver Ayuda).')

  const sourcesReady = sources.length > 0 && sources.some((s) => s.perm !== 'denied')
  const ready = !!disk && sourcesReady && !(disk.encrypted && isLocked(disk))

  return (
    <>
      <Card title="Discos de backup" actions={<Button variant="ghost" onClick={addDisk} disabled={running}>+ Añadir disco</Button>}>
        {disks.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Conecta el disco externo y elige (o crea) la carpeta donde se guardarán las copias, por ejemplo <i>Backup fotos</i>.
            </p>
            <Button variant="primary" onClick={addDisk}>Elegir carpeta en el disco</Button>
          </div>
        ) : (
          <>
            <p className="mb-2 text-sm font-medium">{connectedCount ? `Disco conectado: ${disk?.name ?? ''}` : 'Ningún disco conectado'}</p>
            <ul className="space-y-2">
              {disks.map((d) => (
                <DiskRow key={d.key} disk={d} active={d.key === disk?.key} showUse={connectedCount > 1} />
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Si un disco conectado aparece como "no conectado" (p. ej. Windows le ha dado otra letra), pulsa "+ Añadir disco" y elige de nuevo su carpeta de backup: la app lo reconoce.
            </p>
          </>
        )}
      </Card>

      <Card title="Fotos que copiar" actions={<Button variant="ghost" onClick={addSource} disabled={running}>+ Añadir carpeta</Button>}>
        {sources.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">Añade las carpetas con tus fotos y vídeos: cámara, capturas, WhatsApp, Telegram, descargas…</p>
            <Button variant="primary" onClick={addSource}>Elegir carpeta de fotos</Button>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {sources.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">📁 {s.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {s.perm === 'granted' ? 'Con acceso · incluye subcarpetas' : s.perm === 'prompt' ? 'Hay que permitir el acceso (se pedirá al hacer el backup)' : 'Acceso denegado: quítala y vuelve a añadirla'}
                  </p>
                </div>
                <div className="flex gap-1">
                  {s.perm === 'prompt' && <Button className="px-3 py-1 text-xs" onClick={() => grantSource(s.key)}>Permitir</Button>}
                  <Button variant="ghost" className="px-2 py-1 text-xs" disabled={running} onClick={() => removeSource(s.key)}>Quitar</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {isAndroid && (
          <div className="mt-3">
            <button className="text-xs text-emerald-700 underline dark:text-emerald-400" onClick={() => setShowTips(!showTips)}>
              ¿Qué carpetas añadir en Android?
            </button>
            {showTips && (
              <div className="mt-2 rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-800">
                <ul className="space-y-1">
                  {ANDROID_FOLDERS.map(([n, p]) => (
                    <li key={n}>
                      <b>{n}:</b> {p}
                    </li>
                  ))}
                </ul>
                <p className="mt-2">
                  Android no permite elegir la raíz del almacenamiento, la carpeta Download entera ni <i>Android/data</i>. Si una carpeta no se
                  puede seleccionar, es una restricción de Android: elige sus subcarpetas o usa el modo compatible (selector de archivos).
                </p>
              </div>
            )}
          </div>
        )}
      </Card>

      {warnings.length > 0 && (
        <Alert tone="warn">
          <p className="font-medium">Avisos</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      {running ? (
        <Button variant="primary" className="py-4 text-lg" onClick={() => go('progress')}>Ver el backup en curso</Button>
      ) : (
        <Button variant="primary" className="py-5 text-lg" disabled={!ready} onClick={() => void start()}>
          {disk ? `Hacer backup en ${disk.name}` : 'Hacer backup'}
        </Button>
      )}
      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        Nunca se borra ni se modifica nada en las carpetas de origen. Las fotos que ya están en el disco no se vuelven a copiar.
      </p>
    </>
  )
}
