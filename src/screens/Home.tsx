import { Alert, Button, Card } from '../components/ui'
import { daysSince, formatDateTime } from '../core/format'
import { capabilities } from '../platform/capabilities'
import { useApp } from '../state/app'

function PermissionLine({ perm, onGrant, label }: { perm: PermissionState | null; onGrant: () => void; label: string }) {
  if (perm === 'granted') return <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ Acceso concedido</span>
  if (perm === 'prompt')
    return (
      <Button variant="primary" onClick={onGrant} className="mt-2">
        {label}
      </Button>
    )
  if (perm === 'denied') return <span className="text-xs text-rose-600">Acceso denegado: vuelve a elegir la carpeta.</span>
  return null
}

export function HomeScreen() {
  const { source, sourcePerm, dest, destPerm, diskName, history, running, chooseSource, chooseDest, grant, start, go } = useApp()

  if (!capabilities.fsAccess) {
    return (
      <Alert tone="warn">
        <p className="font-medium">Este navegador no permite escribir directamente en un disco.</p>
        <p className="mt-1">
          Esta primera versión funciona en <b>Chrome o Edge de escritorio</b> (Windows, macOS, Linux, ChromeOS). Para Safari, iPhone y
          Firefox habrá un modo compatible que genera archivos ZIP para guardarlos en el disco a mano.
        </p>
      </Alert>
    )
  }

  const last = history.find((h) => h.diskName === diskName && h.outcome === 'completed')
  const ready = !!source && !!dest && sourcePerm !== 'denied' && destPerm !== 'denied'

  return (
    <>
      <Card title="Disco de destino" actions={dest && <Button variant="ghost" onClick={chooseDest} disabled={running}>Cambiar</Button>}>
        {dest ? (
          <div>
            <p className="text-lg font-medium">💽 {diskName ?? dest.name}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Carpeta de backup: {dest.name}</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {last ? `Último backup: ${formatDateTime(last.finishedAt)} (hace ${daysSince(last.finishedAt)} días)` : 'Aún no hay backups en este disco desde esta app.'}
            </p>
            <PermissionLine perm={destPerm} onGrant={() => grant('dest')} label="Permitir acceso al disco" />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Conecta el disco externo y elige (o crea) la carpeta donde se guardarán las copias, por ejemplo <i>Backup fotos</i>.
            </p>
            <Button variant="primary" onClick={chooseDest}>
              Elegir carpeta en el disco
            </Button>
          </div>
        )}
      </Card>

      <Card title="Fotos que copiar" actions={source && <Button variant="ghost" onClick={chooseSource} disabled={running}>Cambiar</Button>}>
        {source ? (
          <div>
            <p className="text-lg font-medium">📁 {source.name}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Se recorren también todas sus subcarpetas.</p>
            <PermissionLine perm={sourcePerm} onGrant={() => grant('source')} label="Permitir acceso a la carpeta" />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">Elige la carpeta con tus fotos y vídeos (por ejemplo, Imágenes).</p>
            <Button variant="primary" onClick={chooseSource}>
              Elegir carpeta de fotos
            </Button>
          </div>
        )}
      </Card>

      {running ? (
        <Button variant="primary" className="py-4 text-lg" onClick={() => go('progress')}>
          Ver el backup en curso
        </Button>
      ) : (
        <Button variant="primary" className="py-5 text-lg" disabled={!ready} onClick={() => void start()}>
          Hacer backup
        </Button>
      )}
      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        Nunca se borra ni se modifica nada en la carpeta de origen. Las fotos que ya están en el disco no se vuelven a copiar.
      </p>
    </>
  )
}
