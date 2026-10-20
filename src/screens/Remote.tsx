import qrcode from 'qrcode-generator'
import { Check, Copy, FolderPlus, Globe, House, Loader2, Smartphone } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, PageHeader, ProgressBar, StatusDot } from '../components/ui'
import { formatBytes, formatDuration, plural } from '../core/format'
import { useApp } from '../state/app'
import { useRemote } from '../state/remote'

const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
const isPhone = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/** Código QR del enlace de emparejamiento (SVG, se escanea con la cámara del móvil). */
function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
  }, [text])
  return <div className="w-56 max-w-full rounded-xl bg-white p-2 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
}

/** En el PC de casa: esperar al móvil. */
function Receiver() {
  const { receiver, receiverError, phone, link, pairing, startReceiver, stopReceiver, resetPairing } = useRemote()
  const { running, progress, setNotice } = useApp()
  return (
    <Card title="Este PC: recibir del móvil" icon={House} description="Déjalo activado en el PC de casa, con el disco conectado.">
      {receiver === 'on' ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ok">
            <StatusDot tone="ok" /> Esperando al móvil{phone ? ` · conectado: ${phone}` : ''}
          </p>
          {running && phone && progress && (
            <div className="space-y-1">
              <ProgressBar value={progress.totalBytes ? (progress.doneBytes / progress.totalBytes) * 100 : 0} />
              <p className="text-xs text-muted">Copiando lo que envía {phone}… ({progress.counters.copied} copiados)</p>
            </div>
          )}
          {link && (
            <div className="flex flex-col items-start gap-3 sm:flex-row">
              <Qr text={link} />
              <div className="space-y-2 text-sm">
                <p className="font-medium">Emparejar el móvil (solo la primera vez)</p>
                <ol className="list-decimal space-y-1 pl-5 text-muted">
                  <li>Abre la cámara del móvil y apunta a este código.</li>
                  <li>Abre el enlace que aparece (en Chrome).</li>
                  <li>Listo: el móvil ya puede copiar aquí desde cualquier sitio.</li>
                </ol>
                <Button
                  size="sm"
                  icon={Copy}
                  onClick={() => {
                    void navigator.clipboard?.writeText(link)
                    setNotice('Enlace copiado: ábrelo en el móvil (por ejemplo, enviándotelo a ti mismo).')
                  }}
                >
                  Copiar el enlace
                </Button>
              </div>
            </div>
          )}
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            <li>Mantén esta pestaña abierta y el PC encendido: en Windows, Configuración → Sistema → Energía → "Suspender: nunca" (al menos con el cargador).</li>
            <li>Las fotos van directas del móvil a este PC, cifradas. Solo el móvil emparejado puede enviar.</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={stopReceiver} disabled={running}>Dejar de recibir</Button>
            <Button
              variant="ghost"
              disabled={running}
              onClick={() => {
                if (confirm('¿Crear una clave nueva? El móvil emparejado tendrá que volver a escanear el código.')) void resetPairing()
              }}
            >
              Cambiar la clave
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {receiverError && <Alert tone="error">{receiverError}</Alert>}
          <p className="text-sm text-muted">
            Con esto activado, el móvil puede copiar sus fotos en este PC desde cualquier sitio con internet (no hace falta estar en la misma wifi).
            Se guardan en el disco de "Dónde guardar", como un backup normal: carpeta "móvil - fecha y hora", misma estructura, verificadas.
            {pairing ? ` Emparejado con la clave de "${pairing.pcName}".` : ''}
          </p>
          <Button variant="primary" icon={Globe} disabled={receiver === 'starting'} onClick={() => void startReceiver()}>
            {receiver === 'starting' ? 'Activando…' : 'Recibir del móvil'}
          </Button>
        </div>
      )}
    </Card>
  )
}

/** Carpetas típicas de Android: se añaden una vez (Android no deja a una web leer todo el móvil de golpe). */
const SUGGESTED: Array<{ label: string; hint: string }> = [
  { label: 'Cámara', hint: 'elige la carpeta DCIM' },
  { label: 'Capturas y fotos', hint: 'elige la carpeta Pictures' },
  { label: 'WhatsApp', hint: 'Android → media → com.whatsapp → WhatsApp → Media' },
]

/** En el móvil: copiar en el PC de casa, igual que por cable pero a distancia. */
function Sender() {
  const { target, sender, senderInfo, progress, result, pc, chosenDisk, connect, chooseDisk, send, cancelSend, forgetTarget } = useRemote()
  const { sources, settings, saveSettings, addSource, removeSource } = useApp()
  const busy = sender === 'scanning' || sender === 'sending'
  // Al entrar, se conecta solo con el PC (para ver si está recibiendo y sus destinos).
  useEffect(() => {
    if (target && (sender === 'idle' || sender === 'offline' || sender === 'done' || sender === 'error')) void connect()
    // Solo al entrar o al emparejar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  if (!target) {
    return (
      <Card title="Copiar las fotos de este móvil en tu PC" icon={Smartphone} description="Desde cualquier sitio con internet.">
        <div className="space-y-2 text-sm text-muted">
          <p>Primero, empareja este móvil con tu PC (solo una vez):</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>En el PC, abre esta web → <b>Móvil ↔ PC</b> → <b>Recibir del móvil</b>.</li>
            <li>Escanea con la cámara de este móvil el código QR que aparece y abre el enlace en Chrome.</li>
          </ol>
          {!isAndroid && isPhone && <Alert tone="warn">En iPhone el navegador no deja leer las carpetas de fotos: esta función es para Android (Chrome).</Alert>}
        </div>
      </Card>
    )
  }

  const disks = pc?.disks ?? []
  const disk = disks.find((d) => d.key === chosenDisk)
  return (
    <Card title={`Copiar en ${target.pcName}`} icon={Smartphone} description="Igual que por cable, pero desde cualquier sitio con internet.">
      <div className="space-y-5">
        {/* 1. El PC */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusDot tone={pc && (sender === 'online' || busy) ? 'ok' : sender === 'connecting' ? 'pending' : 'off'} />
          {sender === 'connecting' ? (
            <span className="flex items-center gap-1.5 text-muted">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Conectando con {target.pcName}…
            </span>
          ) : pc && (sender === 'online' || busy) ? (
            <span>
              <b>{pc.name}</b> está recibiendo
            </span>
          ) : (
            <>
              <span className="text-muted">{senderInfo ?? `${target.pcName} no está recibiendo.`}</span>
              <Button size="sm" onClick={() => void connect()}>Reintentar</Button>
            </>
          )}
        </div>

        {/* 2. Dónde se guarda (destinos del PC) */}
        {pc && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Se guarda en</p>
            {disks.length === 0 ? (
              <Alert tone="warn">El PC no tiene ningún destino. En el PC: Inicio → Dónde guardar → Añadir.</Alert>
            ) : (
              <div className="flex flex-wrap gap-2">
                {disks.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    disabled={busy}
                    onClick={() => chooseDisk(d.key)}
                    className={`rounded-xl border px-3 py-2 text-left text-sm ${d.key === chosenDisk ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line hover:bg-surface-2'}`}
                  >
                    <span className="font-medium">{d.name}</span>
                    <span className="block text-xs text-muted">{d.ready ? 'conectado' : 'no conectado en el PC'}</span>
                  </button>
                ))}
              </div>
            )}
            {disk && !disk.ready && <p className="text-xs text-warn">Ese destino no está conectado en el PC ahora mismo.</p>}
          </div>
        )}

        {/* 3. Qué se copia (todo lo de este móvil) */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Se copia de este móvil</p>
          {sources.length > 0 && (
            <ul className="space-y-1">
              {sources.map((s) => (
                <li key={s.key} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-sm">
                  <Check size={14} className="shrink-0 text-ok" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <button type="button" className="text-xs text-muted underline" disabled={busy} onClick={() => void removeSource(s.key)}>
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {SUGGESTED.map((f) => (
              <Button key={f.label} size="sm" icon={FolderPlus} disabled={busy} onClick={() => void addSource()} title={f.hint}>
                {f.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted">
            {sources.length === 0
              ? 'Solo la primera vez: Android no deja a una web leer todo el móvil de golpe. Pulsa cada botón y elige la carpeta (Cámara → DCIM, Capturas y fotos → Pictures, WhatsApp → Android/media/com.whatsapp/WhatsApp/Media). Quedan guardadas.'
              : 'Se copian todas sus fotos y vídeos, con todas sus subcarpetas.'}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={settings.whatsappSent} disabled={busy} onChange={(e) => void saveSettings({ ...settings, whatsappSent: e.target.checked })} />
            Incluir lo enviado por WhatsApp (Sent)
          </label>
        </div>

        {/* 4. Copiar */}
        {busy ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 size={16} className="animate-spin" aria-hidden /> {senderInfo}
            </p>
            {progress && (
              <>
                <ProgressBar value={progress.pct} />
                <p className="text-xs text-muted">
                  {progress.pct}% · {progress.copied} copiados · {formatBytes(progress.speed)}/s{progress.eta !== null ? ` · quedan ${formatDuration(progress.eta)}` : ''}
                </p>
              </>
            )}
            <p className="text-xs text-muted">Mantén la pantalla encendida y esta pestaña abierta hasta que termine.</p>
            <Button variant="ghost" onClick={cancelSend}>Cancelar</Button>
          </div>
        ) : (
          <>
            {(sender === 'done' || sender === 'error') && senderInfo && (
              <Alert tone={sender === 'done' ? 'ok' : 'error'}>
                <p className="font-medium">{senderInfo}</p>
                {result && sender === 'done' && (
                  <p className="mt-1">
                    {plural(result.copied, 'foto o vídeo copiado', 'fotos y vídeos copiados')}
                    {result.folder ? ` en "${result.folder}"` : ''}
                    {result.errors ? ` · ${result.errors} no se han podido copiar (siguen en el móvil)` : ''}.
                  </p>
                )}
              </Alert>
            )}
            <Button
              variant="primary"
              size="xl"
              icon={House}
              className="w-full"
              disabled={sources.length === 0 || !pc || !disk?.ready}
              onClick={() => void send()}
            >
              Copiar ahora
            </Button>
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>Con datos móviles, miles de fotos son muchos GB: mejor desde una wifi.</span>
          <button type="button" className="underline" onClick={() => void forgetTarget()}>Desemparejar</button>
        </div>
      </div>
    </Card>
  )
}
export function RemoteScreen() {
  const loadTarget = useRemote((s) => s.loadTarget)
  // Cada aparato ve solo su parte: el móvil envía, el PC recibe (la otra, por si acaso, a un clic).
  const [other, setOther] = useState(false)
  useEffect(() => {
    void loadTarget()
  }, [loadTarget])
  return (
    <>
      <PageHeader
        title="Móvil ↔ PC"
        subtitle={isPhone ? 'Copia las fotos de este móvil en tu PC de casa desde cualquier sitio' : 'Recibe en este PC las fotos del móvil, esté donde esté'}
      />
      {isPhone ? <Sender /> : <Receiver />}
      <button type="button" className="text-left text-xs text-muted underline" onClick={() => setOther(!other)}>
        {isPhone ? '¿Estás en el PC de casa? Ver la parte de recibir' : '¿Estás en el móvil? Ver la parte de enviar'}
      </button>
      {other && (isPhone ? <Receiver /> : <Sender />)}
    </>
  )
}
