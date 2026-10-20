import qrcode from 'qrcode-generator'
import { Copy, Globe, House, Loader2, Smartphone } from 'lucide-react'
import { useEffect, useMemo } from 'react'
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

/** En el móvil: enviar al PC de casa. */
function Sender() {
  const { target, sender, senderInfo, progress, result, send, cancelSend, forgetTarget } = useRemote()
  const { sources, settings, go } = useApp()
  const busy = sender === 'connecting' || sender === 'scanning' || sender === 'sending'
  return (
    <Card title="Este móvil: copiar en el PC de casa" icon={Smartphone} description="Desde cualquier sitio con internet.">
      {!target ? (
        <div className="space-y-2 text-sm text-muted">
          <p>Para emparejar este móvil con tu PC:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>En el PC, abre esta web → <b>Móvil ↔ PC</b> → <b>Recibir del móvil</b>.</li>
            <li>Escanea con la cámara de este móvil el código QR que aparece y abre el enlace en Chrome.</li>
          </ol>
          {!isAndroid && isPhone && <Alert tone="warn">En iPhone el navegador no deja leer las carpetas de fotos: esta función es para Android (Chrome).</Alert>}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            Emparejado con <b>{target.pcName}</b>. Se copiarán {plural(sources.length, 'carpeta', 'carpetas')} de este móvil
            {settings.whatsappSent ? '' : ' (sin lo enviado por WhatsApp)'}.
          </p>
          {sources.length === 0 && (
            <Alert tone="warn">
              Añade primero las carpetas con fotos: <button className="underline" onClick={() => go('home')}>Inicio → Fotos que copiar → Añadir</button> (DCIM,
              Pictures, WhatsApp…).
            </Alert>
          )}
          {busy && (
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
          )}
          {!busy && senderInfo && (
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
          {!busy && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" icon={House} disabled={sources.length === 0} onClick={() => void send()}>
                Copiar en {target.pcName}
              </Button>
              <Button variant="ghost" onClick={() => void forgetTarget()}>Desemparejar</Button>
            </div>
          )}
          <p className="text-xs text-muted">Con datos móviles, miles de fotos son muchos GB: mejor desde una wifi.</p>
        </div>
      )}
    </Card>
  )
}

export function RemoteScreen() {
  const loadTarget = useRemote((s) => s.loadTarget)
  useEffect(() => {
    void loadTarget()
  }, [loadTarget])
  return (
    <>
      <PageHeader title="Móvil ↔ PC" subtitle="Copia las fotos del móvil en el PC de casa desde cualquier sitio, por internet" />
      {isPhone ? (
        <>
          <Sender />
          <Receiver />
        </>
      ) : (
        <>
          <Receiver />
          <Sender />
        </>
      )}
    </>
  )
}
