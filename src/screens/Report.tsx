import { AlertOctagon, Ban, ClipboardCheck, Copy, Files, HardDrive, Images, ShieldQuestion } from 'lucide-react'
import { useCallback, useMemo, useRef } from 'react'
import { Gallery, type BlobGetter } from '../components/Gallery'
import { Thumb } from '../components/Thumb'
import { Alert, Button, Card, PageHeader, Stat } from '../components/ui'
import type { DiscardCategory } from '../core/analysis/classify'
import type { BackupReport, Outcome, ReportItem } from '../core/backup/engine'
import { formatBytes, formatDuration, plural } from '../core/format'
import { activeDisk, scannedFile, useApp } from '../state/app'
import { diskTarget, isLocked, useKeys } from '../state/keys'

const OUTCOME: Record<Outcome, { tone: 'ok' | 'warn' | 'error'; text: string }> = {
  completed: { tone: 'ok', text: 'Backup terminado.' },
  cancelled: { tone: 'warn', text: 'Backup cancelado. Lo copiado hasta ahora está guardado y no se repetirá.' },
  'disk-disconnected': {
    tone: 'error',
    text: 'El disco se desconectó durante el backup. Vuelve a conectarlo y pulsa "Hacer backup": continuará donde se quedó, sin duplicar nada.',
  },
  'disk-full': { tone: 'error', text: 'El disco se ha llenado. Libera espacio en el disco o usa otro, y vuelve a lanzar el backup.' },
  'manifest-corrupt': {
    tone: 'error',
    text: 'El registro del disco (.backup-manifest.json) y su copia (.bak) están dañados, así que no se ha copiado nada para no duplicar fotos. Más adelante la app podrá reconstruirlo escaneando el disco (Herramientas → Reconstruir manifest).',
  },
  failed: { tone: 'error', text: 'El backup se detuvo por un error.' },
}

const CATEGORY: Record<DiscardCategory, string> = {
  corrupt: 'Dañados',
  empty: 'Vacíos (negros, blancos o de un color)',
  small: 'Demasiado pequeños',
  blurry: 'Muy borrosos',
  short: 'Vídeos demasiado cortos',
}

const LIST_LIMIT = 300

function ItemList({ title, items, showPath, open, hideSize }: { title: string; items: ReportItem[]; showPath?: boolean; open?: boolean; hideSize?: boolean }) {
  if (items.length === 0) return null
  return (
    <details open={open} className="card p-4">
      <summary className="cursor-pointer text-sm font-medium">
        {title} <span className="text-muted">({items.length})</span>
      </summary>
      <ul className="mt-2 max-h-80 space-y-1 overflow-auto text-xs">
        {items.slice(0, LIST_LIMIT).map((it, i) => (
          <li key={i} className="border-b border-line pb-1 last:border-0">
            <span className="font-medium break-all">{it.sourcePath}</span>
            {!hideSize && <span className="text-muted"> · {formatBytes(it.size)}</span>}
            {showPath && it.diskPath && <div className="break-all text-muted">→ {it.diskPath}</div>}
            {it.reason && <div className="text-muted">{it.reason}</div>}
          </li>
        ))}
        {items.length > LIST_LIMIT && <li className="text-muted">…y {items.length - LIST_LIMIT} más</li>}
      </ul>
    </details>
  )
}

function Discarded({ items }: { items: ReportItem[] }) {
  const { start, running } = useApp()
  if (items.length === 0) return null
  const groups = new Map<string, ReportItem[]>()
  for (const it of items) {
    const k = it.category ?? 'corrupt'
    groups.set(k, [...(groups.get(k) ?? []), it])
  }
  return (
    <Card
      title={`Descartados (${items.length})`}
      actions={
        <Button disabled={running} onClick={() => void start(items.map((i) => i.sourcePath))}>
          Copiar todos igualmente
        </Button>
      }
    >
      <p className="mb-3 text-xs text-muted">
        No se han copiado, pero <b>siguen intactos en el origen</b>. Si alguno te interesa, cópialo igualmente: quedará marcado como "no verificado".
      </p>
      {running && <p className="mb-2 text-sm text-ok">Copiando…</p>}
      <div className="space-y-4">
        {[...groups].map(([cat, list]) => (
          <div key={cat}>
            <h3 className="mb-2 text-sm font-semibold">
              {CATEGORY[cat as DiscardCategory] ?? cat} <span className="font-normal text-muted">({list.length})</span>
            </h3>
            <ul className="space-y-2">
              {list.slice(0, LIST_LIMIT).map((it) => (
                <li key={it.sourcePath} className="flex items-center gap-3">
                  <Thumb file={scannedFile(it.sourcePath)} />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="truncate font-medium" title={it.sourcePath}>
                      {it.sourcePath}
                    </div>
                    <div className="text-muted">
                      {it.reason} · {formatBytes(it.size)}
                    </div>
                  </div>
                  <Button variant="ghost" className="shrink-0 px-2 text-xs" disabled={running} onClick={() => void start([it.sourcePath])}>
                    Copiar igualmente
                  </Button>
                </li>
              ))}
              {list.length > LIST_LIMIT && <li className="text-xs text-muted">…y {list.length - LIST_LIMIT} más</li>}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** Fotos y vídeos copiados en este backup, para verlos uno a uno. */
function Copied({ report }: { report: BackupReport }) {
  const { disks, diskStates } = useApp()
  useKeys()
  const items = useMemo(() => [...report.copied, ...report.alreadyOnDisk], [report])
  // Con una carpeta por copia, el identificador es el de la copia: el disco es el destino activo.
  const disk = disks.find((d) => d.diskId && d.diskId === report.diskId) ?? (report.folder ? activeDisk() : undefined)
  const diskReady = !!disk && diskStates[disk.key]?.state === 'connected' && !(disk.encrypted && isLocked(disk))

  // El registro del disco se renueva con cada sondeo: se guarda en una ref para
  // no recargar las miniaturas cada 3 segundos.
  const diskRef = useRef(disk)
  diskRef.current = disk

  // Primero del origen (al momento, sin tocar el disco); si ya no está, del disco.
  const getBlob = useCallback<BlobGetter>(
    async (it) => {
      const f = scannedFile(it.sourcePath)
      if (f) {
        try {
          return await f.getFile()
        } catch {
          // El origen ya no está (móvil desconectado…): se lee del disco.
        }
      }
      const d = diskRef.current
      if (!d || !diskReady || !it.diskPath) return null
      return diskTarget(d).readFile(it.diskPath)
    },
    [diskReady],
  )

  if (items.length === 0) return null
  return (
    <div id="copiados" className="scroll-mt-4">
      <Card
        title={`Copiados (${items.length})`}
        icon={Images}
        description={
          report.folder ? (
            <>
              Guardados en la carpeta <b className="text-fg">{report.folder}</b> del disco. Toca una foto para verla.
            </>
          ) : (
            'Toca una foto para verla a tamaño completo.'
          )
        }
      >
        <Gallery items={items} getBlob={getBlob} />
      </Card>
    </div>
  )
}

function ManifestNotice({ report }: { report: BackupReport }) {
  const m = report.manifest
  if (!m) return null
  const msgs: string[] = []
  if (m.source === 'bak') msgs.push('El manifest principal estaba dañado y se ha recuperado desde la copia .bak.')
  if (m.source === 'tmp') msgs.push('Se ha recuperado el manifest de una escritura que no llegó a completarse.')
  if (m.journalApplied) msgs.push(`Se han incorporado ${m.journalApplied} bloques de un backup anterior que se interrumpió.`)
  if (m.journalCorrupt) msgs.push(`${m.journalCorrupt} bloques del diario estaban dañados; sus fotos se han localizado en el disco sin recopiarlas.`)
  if (msgs.length === 0) return null
  return (
    <Alert tone="warn">
      {msgs.map((t) => (
        <p key={t}>{t}</p>
      ))}
    </Alert>
  )
}

export function ReportScreen() {
  const { report, go } = useApp()
  if (!report) return <p className="text-muted">Todavía no hay ningún informe.</p>

  const o = OUTCOME[report.outcome]
  const secs = (new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()) / 1000

  return (
    <>
      <PageHeader title="Informe del backup" subtitle={new Date(report.finishedAt).toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })} />
      <Alert tone={o.tone}>
        <p className="font-medium">{o.text}</p>
        {report.failure && <p className="mt-1 text-xs">{report.failure}</p>}
      </Alert>
      <ManifestNotice report={report} />

      <Card title="Resumen" icon={ClipboardCheck}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat
            label="Copiados"
            value={report.copied.length + report.alreadyOnDisk.length}
            tone="ok"
            icon={Copy}
            hint={report.copied.length + report.alreadyOnDisk.length ? 'Ver fotos →' : undefined}
            onClick={report.copied.length + report.alreadyOnDisk.length ? () => document.getElementById('copiados')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : undefined}
          />
          <Stat label="Duplicados omitidos" value={report.duplicates.length} icon={Files} />
          <Stat label="Descartados" value={report.discarded.length} tone={report.discarded.length ? 'warn' : undefined} icon={Ban} />
          <Stat label="No verificados" value={report.unverified.length} tone={report.unverified.length ? 'warn' : undefined} icon={ShieldQuestion} />
          <Stat label="Errores" value={report.errors.length + report.fat32.length} tone={report.errors.length + report.fat32.length ? 'error' : undefined} icon={AlertOctagon} />
          <Stat label="Datos copiados" value={formatBytes(report.bytesCopied)} icon={HardDrive} />
        </div>
        <p className="mt-3 text-xs text-muted">
          {plural(report.scanned, 'foto o vídeo analizado', 'fotos y vídeos analizados')} en {formatDuration(secs)}
          {report.searched && `, buscando en ${plural(report.searched.count, 'carpeta', 'carpetas')} (con todas sus subcarpetas)`}.
          {report.duplicates.length > 0 &&
            ` ${plural(report.duplicates.length, 'archivo no se ha copiado porque ya estaba', 'archivos no se han copiado porque ya estaban')} ${report.folder ? 'repetidos en la selección' : 'guardados en el disco (de backups anteriores o copiados antes a esa carpeta)'}: no se duplica nada.`}
          {report.ignored.count > 0 && ` Se ${report.ignored.count === 1 ? 'ha' : 'han'} ignorado ${plural(report.ignored.count, 'archivo que no es foto ni vídeo', 'archivos que no son fotos ni vídeos')}.`}
          {report.livePhotos > 0 && ` ${plural(report.livePhotos, 'Live Photo (foto + vídeo) se ha guardado junta', 'Live Photos (foto + vídeo) se han guardado juntas')} con el mismo nombre.`}
          {report.motionPhotos > 0 && ` ${plural(report.motionPhotos, 'Motion Photo se ha copiado', 'Motion Photos se han copiado')} con su vídeo incrustado.`}
          {report.incorporated > 0 && ` ${plural(report.incorporated, 'foto que ya estaba', 'fotos que ya estaban')} en el disco (copiadas antes a mano) se han incorporado al registro sin tocarlas.`}
        </p>
      </Card>

      {report.outcome === 'completed' && report.searched && report.searched.count >= 1 && report.searched.count <= 3 && report.scanned < 50 && (
        <Alert tone="warn">
          <p className="font-medium">Solo se han encontrado {plural(report.scanned, 'foto o vídeo', 'fotos y vídeos')}: ¿es esa la carpeta de tu móvil?</p>
          <p className="mt-1">
            La app busca en todas las subcarpetas, pero la carpeta elegida solo tenía{' '}
            {plural(report.searched.count - 1, 'subcarpeta', 'subcarpetas')}. En Windows, el móvil que se puede elegir como carpeta
            ("Dispositivos móviles" / Enlace a Windows) no es su memoria: es una carpeta del PC con unas pocas fotos recientes. Para copiar
            todas, quita ese origen, conecta el móvil por cable en modo "Transferencia de archivos" y usa <b>Elegir fotos sueltas</b> → Este
            equipo → tu móvil → Almacenamiento interno → DCIM → Camera → Ctrl + A → Abrir.
          </p>
        </Alert>
      )}

      {report.reduced.length > 0 && (
        <Alert tone="warn">
          <p className="font-medium">{report.reduced.length === 1 ? 'Una foto podría ser una versión reducida.' : `${report.reduced.length} fotos podrían ser versiones reducidas.`}</p>
          <p className="mt-1">
            Su resolución es mucho menor que la que indica su EXIF: puede que el original esté solo en iCloud o Google Fotos ("optimizar
            almacenamiento"). Se han copiado igualmente. Descarga los originales al dispositivo y vuelve a hacer el backup (ver Ayuda).
          </p>
        </Alert>
      )}

      {report.fat32.length > 0 && (
        <Alert tone="error">
          <p className="font-medium">
            {report.fat32.length === 1 ? 'Un archivo de más de 4 GB no se ha podido copiar' : `${report.fat32.length} archivos de más de 4 GB no se han podido copiar`}
            : el disco parece estar formateado en FAT32.
          </p>
          <p className="mt-1">
            FAT32 no admite archivos de 4 GB o más (vídeos largos). El resto del backup se ha hecho con normalidad y esos archivos siguen en el
            origen. Para copiarlos, formatea el disco en <b>exFAT</b> (funciona en Windows y macOS). <b>Formatear borra el disco</b>: copia antes su
            contenido a otro sitio.
          </p>
          <ul className="mt-1 list-disc pl-5">
            <li>Windows: Explorador → clic derecho en el disco → Formatear → Sistema de archivos: exFAT → Iniciar.</li>
            <li>macOS: Utilidad de Discos → selecciona el disco → Borrar → Formato: ExFAT → Borrar.</li>
          </ul>
        </Alert>
      )}

      <Copied report={report} />

      <Discarded items={report.discarded} />

      <div className="space-y-2">
        <ItemList title="Errores" items={report.errors} open />
        <ItemList title="No copiados por el límite de 4 GB de FAT32" items={report.fat32} open />
        <ItemList title="Posibles versiones reducidas" items={report.reduced} showPath />
        <ItemList title="No verificados (copiados, pero no se ha podido comprobar su contenido)" items={report.unverified} showPath />
        <ItemList title="Lista de copiados (origen → disco)" items={report.copied} showPath />
        <ItemList title="Ya estaban en el disco (backup anterior interrumpido)" items={report.alreadyOnDisk} showPath />
        <ItemList title="Duplicados omitidos" items={report.duplicates} showPath />
        <ItemList title="Ignorados (no son fotos ni vídeos)" items={report.ignored.sample.map((p) => ({ name: p, sourcePath: p, size: 0 }))} />
        {report.searched && (
          <ItemList title="Carpetas en las que se ha buscado" items={report.searched.sample.map((p) => ({ name: p, sourcePath: p, size: 0 }))} hideSize />
        )}
      </div>

      <Button onClick={() => go('home')}>Volver al inicio</Button>
    </>
  )
}
