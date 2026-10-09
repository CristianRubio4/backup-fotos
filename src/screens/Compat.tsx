import { CheckCircle2, Download, FileArchive, FileJson, FolderOpen, ImagePlus, Info, Loader2, Square, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Thumb } from '../components/Thumb'
import { Alert, Badge, Button, Card, PageHeader, ProgressBar, Stat } from '../components/ui'
import { formatBytes, plural } from '../core/format'
import { capabilities } from '../platform/capabilities'
import { isIOS, useCompat } from '../state/compat'

const isFirefox = typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent)

/**
 * Modo compatible (Safari/iPhone, Firefox): estos navegadores no permiten
 * escribir en carpetas del disco, así que la app prepara ZIP que el usuario
 * guarda en el disco a mano.
 */
export function CompatScreen() {
  const c = useCompat()
  const [acceptAll, setAcceptAll] = useState(true)
  const total = c.files.reduce((a, f) => a + f.size, 0)
  const p = c.progress
  const busy = !!p || c.zipping !== null

  return (
    <>
      <PageHeader
        title="Modo compatible"
        subtitle="Para Safari (iPhone, iPad, Mac) y Firefox"
        actions={capabilities.compatForced ? <a className="text-sm font-medium text-accent-strong" href={import.meta.env.BASE_URL}>Volver al modo completo</a> : undefined}
      />

      <Alert tone="info">
        <p className="font-medium">Por qué este modo es manual</p>
        <p className="mt-1 text-muted">
          Este navegador no permite que una web escriba en una carpeta del disco. La app analiza tus fotos igual (descarta las dañadas y las
          repetidas) y prepara archivos <b>ZIP</b> por lotes. Tú los guardas en el disco externo y los descomprimes allí. En Chrome o Edge
          (ordenador o Android) el backup es automático.
        </p>
      </Alert>

      {c.error && <Alert tone="error" onClose={() => useCompat.setState({ error: null })}>{c.error}</Alert>}

      <Card title="1. Elige las fotos" icon={ImagePlus} description={c.files.length ? `${plural(c.files.length, 'archivo', 'archivos')} · ${formatBytes(total)}${c.ignored ? ` · ${plural(c.ignored, 'ignorado (no es foto ni vídeo)', 'ignorados (no son fotos ni vídeos)')}` : ''}` : 'Puedes añadir varias tandas.'}>
        <div className="flex flex-wrap gap-2">
          <label className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            <ImagePlus size={16} aria-hidden /> Añadir fotos y vídeos
            <input
              type="file"
              multiple
              // En iPhone, "image/*" hace que Safari convierta las HEIC a JPEG; sin restricción entrega los originales.
              accept={acceptAll ? '*/*' : 'image/*,video/*'}
              className="sr-only"
              onChange={(e) => {
                c.addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          {!isIOS && (
            <label className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-2 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
              <FolderOpen size={16} aria-hidden /> Añadir una carpeta entera
              <input
                type="file"
                multiple
                className="sr-only"
                {...({ webkitdirectory: '' } as Record<string, string>)}
                onChange={(e) => {
                  c.addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
          )}
          {c.files.length > 0 && <Button variant="ghost" icon={Trash2} disabled={busy} onClick={c.clearFiles}>Vaciar</Button>}
        </div>
        {isIOS && (
          <div className="mt-4 space-y-2 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed">
            <p className="flex gap-2">
              <Info size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <span>
                <b>Para conservar los originales (HEIC):</b> al pulsar "Añadir", elige <b>Archivos</b> o <b>Fototeca</b> y, si aparece, pulsa
                <b> Opciones → Actual</b>. Si las fotos llegan convertidas a JPEG, la app te avisará.
              </span>
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="accent-[var(--accent)]" checked={acceptAll} onChange={(e) => setAcceptAll(e.target.checked)} />
              Pedir los archivos originales (recomendado). Desactívalo si tu iPhone no te deja elegir fotos.
            </label>
          </div>
        )}
      </Card>

      <Card title="2. (Opcional) Lo que ya hay en el disco" icon={FileJson} description="Para no volver a incluir fotos que ya están en el disco.">
        <p className="text-sm text-muted">
          La app recuerda lo que ya has exportado desde este navegador. Si el disco tiene backups de otros dispositivos, elige su archivo
          <code className="mx-1 rounded bg-surface-2 px-1">.backup-manifest.json</code> (está en la raíz de la carpeta de backup).
        </p>
        <label className={`mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm hover:bg-surface-2 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          <FileJson size={15} aria-hidden /> Elegir manifest del disco
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => e.target.files?.[0] && void c.importManifest(e.target.files[0])} />
        </label>
        {c.manifestName && <p className="mt-2 text-xs text-ok">✓ {c.manifestName}</p>}
      </Card>

      <Card title="3. Analizar y preparar los ZIP" icon={FileArchive}>
        {p ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 size={16} className="animate-spin text-accent" aria-hidden /> {p.phase === 'hash' ? 'Calculando huellas (hash)' : 'Analizando'} · {p.done} de {p.total}
            </div>
            <ProgressBar value={p.total ? (p.done / p.total) * 100 : 0} large />
            {p.current && <p className="truncate font-mono text-xs text-subtle">{p.current}</p>}
            <Button variant="ghost" icon={Square} onClick={c.cancel}>Cancelar</Button>
          </div>
        ) : (
          <Button variant="primary" size="lg" disabled={!c.files.length || busy} onClick={() => void c.analyze()}>Analizar {c.files.length || ''} archivos</Button>
        )}
      </Card>

      {c.plan && (
        <>
          {c.plan.convertedByIOS.length > 0 && (
            <Alert tone="warn">
              <p className="font-medium">{c.plan.convertedByIOS.length} fotos parecen convertidas a JPEG por Safari.</p>
              <p className="mt-1 text-muted">
                Así se generan archivos distintos en cada backup y se pierde calidad. Vuelve a elegirlas desde la app <b>Archivos</b>, o en la
                Fototeca pulsa <b>Opciones → Actual</b>. Otra opción: Ajustes → Fotos → Transferir a Mac o PC → <b>Mantener originales</b> y
                copiarlas por cable.
              </p>
            </Alert>
          )}
          {isIOS && c.plan.appleWithoutVideo > 0 && (
            <Alert tone="info">Si alguna de tus fotos era una <b>Live Photo</b>, Safari solo entrega la imagen, sin el vídeo. Para conservar el vídeo, copia las fotos por cable a un ordenador o usa la app Archivos.</Alert>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Para guardar" value={c.plan.items.length} tone="ok" />
            <Stat label="Ya guardados / repetidos" value={c.plan.duplicates.length} />
            <Stat label="Descartados" value={c.plan.discarded.length} tone={c.plan.discarded.length ? 'warn' : undefined} />
            <Stat label="No verificados" value={c.plan.unverified.length} tone={c.plan.unverified.length ? 'warn' : undefined} />
          </div>

          {c.plan.discarded.length > 0 && (
            <Card title={`Descartados (${c.plan.discarded.length})`} description="No se incluyen en los ZIP, pero siguen intactos en tu dispositivo." actions={<Button size="sm" disabled={busy} onClick={() => void c.analyze(c.plan!.discarded.map((d) => d.sourcePath))}>Incluir todos igualmente</Button>}>
              <ul className="max-h-72 space-y-2 overflow-auto">
                {c.plan.discarded.map((d) => (
                  <li key={d.sourcePath} className="cv-auto flex items-center gap-3 text-xs">
                    <Thumb file={c.files.find((f) => f.relPath === d.sourcePath)} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{d.sourcePath}</div>
                      <div className="text-muted">{d.reason}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="4. Descarga los ZIP y guárdalos en el disco" icon={Download} description={c.batches.length ? `${c.batches.length} ${c.batches.length === 1 ? 'lote' : 'lotes'} (máx. el tamaño elegido en Ajustes)` : 'No hay nada nuevo que guardar.'}>
            <ul className="space-y-2">
              {c.batches.map((b, i) => {
                const size = b.reduce((a, x) => a + x.file.size, 0)
                const done = c.downloaded.includes(i)
                return (
                  <li key={i} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-3">
                    <FileArchive size={20} className="text-muted" aria-hidden />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium">Lote {i + 1} de {c.batches.length}</div>
                      <div className="text-xs text-muted">{b.length} archivos · {formatBytes(size)}</div>
                    </div>
                    {done && <Badge tone="ok"><CheckCircle2 size={12} /> Descargado</Badge>}
                    <Button size="sm" variant={done ? 'ghost' : 'primary'} icon={c.zipping === i ? Loader2 : Download} disabled={busy} onClick={() => void c.downloadBatch(i)}>
                      {c.zipping === i ? 'Preparando…' : done ? 'Otra vez' : 'Descargar'}
                    </Button>
                  </li>
                )
              })}
            </ul>
            <div className="mt-4 rounded-xl bg-surface-2 p-3 text-xs leading-relaxed">
              {isIOS ? (
                <p>
                  <b>En iPhone/iPad:</b> conecta el disco, abre la descarga y pulsa <b>Compartir → Guardar en Archivos</b>, elige el disco y la
                  carpeta de backup. Después, en la app Archivos, toca el ZIP para descomprimirlo allí y borra el .zip.
                </p>
              ) : isFirefox ? (
                <p>
                  <b>En Firefox:</b> el ZIP va a tu carpeta de descargas (o a la que elijas si tienes activado "Preguntar dónde guardar"). Muévelo a
                  la carpeta de backup del disco y descomprímelo allí.
                </p>
              ) : (
                <p>Guarda el ZIP en la carpeta de backup del disco y descomprímelo allí.</p>
              )}
              <p className="mt-2">
                Los archivos conservan su fecha original y se ordenan en carpetas año/mes. Cuando uses el disco en Chrome o Edge, pulsa
                <b> Herramientas → Incorporar archivos sueltos</b> para registrarlos y verificarlos.
              </p>
            </div>
          </Card>
        </>
      )}
    </>
  )
}
