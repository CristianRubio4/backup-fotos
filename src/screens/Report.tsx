import { Thumb } from '../components/Thumb'
import { Alert, Button, Card, Stat } from '../components/ui'
import type { DiscardCategory } from '../core/analysis/classify'
import type { BackupReport, Outcome, ReportItem } from '../core/backup/engine'
import { formatBytes, formatDuration } from '../core/format'
import { scannedFile, useApp } from '../state/app'

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

function ItemList({ title, items, showPath, open }: { title: string; items: ReportItem[]; showPath?: boolean; open?: boolean }) {
  if (items.length === 0) return null
  return (
    <details open={open} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <summary className="cursor-pointer text-sm font-medium">
        {title} <span className="text-slate-500">({items.length})</span>
      </summary>
      <ul className="mt-2 max-h-80 space-y-1 overflow-auto text-xs">
        {items.slice(0, LIST_LIMIT).map((it, i) => (
          <li key={i} className="border-b border-slate-100 pb-1 last:border-0 dark:border-slate-800">
            <span className="font-medium break-all">{it.sourcePath}</span>
            <span className="text-slate-500"> · {formatBytes(it.size)}</span>
            {showPath && it.diskPath && <div className="break-all text-slate-500">→ {it.diskPath}</div>}
            {it.reason && <div className="text-slate-500">{it.reason}</div>}
          </li>
        ))}
        {items.length > LIST_LIMIT && <li className="text-slate-500">…y {items.length - LIST_LIMIT} más</li>}
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
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        No se han copiado, pero <b>siguen intactos en el origen</b>. Si alguno te interesa, cópialo igualmente: quedará marcado como "no verificado".
      </p>
      {running && <p className="mb-2 text-sm text-emerald-600">Copiando…</p>}
      <div className="space-y-4">
        {[...groups].map(([cat, list]) => (
          <div key={cat}>
            <h3 className="mb-2 text-sm font-semibold">
              {CATEGORY[cat as DiscardCategory] ?? cat} <span className="font-normal text-slate-500">({list.length})</span>
            </h3>
            <ul className="space-y-2">
              {list.slice(0, LIST_LIMIT).map((it) => (
                <li key={it.sourcePath} className="flex items-center gap-3">
                  <Thumb file={scannedFile(it.sourcePath)} />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="truncate font-medium" title={it.sourcePath}>
                      {it.sourcePath}
                    </div>
                    <div className="text-slate-500">
                      {it.reason} · {formatBytes(it.size)}
                    </div>
                  </div>
                  <Button variant="ghost" className="shrink-0 px-2 text-xs" disabled={running} onClick={() => void start([it.sourcePath])}>
                    Copiar igualmente
                  </Button>
                </li>
              ))}
              {list.length > LIST_LIMIT && <li className="text-xs text-slate-500">…y {list.length - LIST_LIMIT} más</li>}
            </ul>
          </div>
        ))}
      </div>
    </Card>
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
  if (!report) return <p className="text-slate-500">Todavía no hay ningún informe.</p>

  const o = OUTCOME[report.outcome]
  const secs = (new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()) / 1000

  return (
    <>
      <Alert tone={o.tone}>
        <p className="font-medium">{o.text}</p>
        {report.failure && <p className="mt-1 text-xs">{report.failure}</p>}
      </Alert>
      <ManifestNotice report={report} />

      <Card title="Resumen">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Copiados" value={report.copied.length + report.alreadyOnDisk.length} tone="ok" />
          <Stat label="Duplicados omitidos" value={report.duplicates.length} />
          <Stat label="Descartados" value={report.discarded.length} tone={report.discarded.length ? 'warn' : undefined} />
          <Stat label="No verificados" value={report.unverified.length} tone={report.unverified.length ? 'warn' : undefined} />
          <Stat label="Errores" value={report.errors.length + report.fat32.length} tone={report.errors.length + report.fat32.length ? 'error' : undefined} />
          <Stat label="Datos copiados" value={formatBytes(report.bytesCopied)} />
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {report.scanned} fotos y vídeos analizados en {formatDuration(secs)}.
          {report.ignored.count > 0 && ` Se han ignorado ${report.ignored.count} archivos que no son fotos ni vídeos.`}
          {report.livePhotos > 0 && ` ${report.livePhotos} Live Photos (foto + vídeo) se han guardado juntas con el mismo nombre.`}
          {report.motionPhotos > 0 && ` ${report.motionPhotos} Motion Photos se han copiado con su vídeo incrustado.`}
          {report.incorporated > 0 && ` ${report.incorporated} fotos que ya estaban en el disco (copiadas antes a mano) se han incorporado al registro sin tocarlas.`}
        </p>
      </Card>

      {report.reduced.length > 0 && (
        <Alert tone="warn">
          <p className="font-medium">{report.reduced.length} fotos podrían ser versiones reducidas.</p>
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

      <Discarded items={report.discarded} />

      <div className="space-y-2">
        <ItemList title="Errores" items={report.errors} open />
        <ItemList title="No copiados por el límite de 4 GB de FAT32" items={report.fat32} open />
        <ItemList title="Posibles versiones reducidas" items={report.reduced} showPath />
        <ItemList title="No verificados (copiados, pero no se ha podido comprobar su contenido)" items={report.unverified} showPath />
        <ItemList title="Copiados" items={report.copied} showPath />
        <ItemList title="Ya estaban en el disco (backup anterior interrumpido)" items={report.alreadyOnDisk} showPath />
        <ItemList title="Duplicados omitidos" items={report.duplicates} showPath />
        <ItemList title="Ignorados (no son fotos ni vídeos)" items={report.ignored.sample.map((p) => ({ name: p, sourcePath: p, size: 0 }))} />
      </div>

      <Button onClick={() => go('home')}>Volver al inicio</Button>
    </>
  )
}
