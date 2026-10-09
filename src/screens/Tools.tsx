import { JobProgress } from '../components/JobProgress'
import { Alert, Button, Card } from '../components/ui'
import type { ManifestEntry } from '../core/manifest/schema'
import { formatBytes, formatDateTime } from '../core/format'
import { activeDisk, useApp } from '../state/app'
import { useTools } from '../state/tools'
import { FreeSpace } from './FreeSpace'

function EntryList({ title, entries }: { title: string; entries: ManifestEntry[] }) {
  if (!entries.length) return null
  return (
    <details open className="mt-2">
      <summary className="cursor-pointer text-sm font-medium">
        {title} ({entries.length})
      </summary>
      <ul className="mt-1 max-h-60 space-y-1 overflow-auto text-xs">
        {entries.slice(0, 300).map((e) => (
          <li key={e.hash}>
            <span className="break-all font-medium">{e.diskPath}</span> <span className="text-slate-500">· {formatBytes(e.size)} · {e.originalName}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

export function ToolsScreen() {
  const { running, go } = useApp()
  const t = useTools()
  const disk = activeDisk()
  const busy = running || !!t.job

  return (
    <>
      {!disk && <Alert tone="warn">Conecta un disco de backup para usar las herramientas.</Alert>}
      {disk && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Disco: <b>{disk.name}</b>
          {disk.lastCheckAt ? ` · última comprobación: ${formatDateTime(disk.lastCheckAt)}` : ' · nunca se ha comprobado'}
        </p>
      )}
      {t.error && (
        <Alert tone="error" onClose={() => useTools.setState({ error: null })}>
          {t.error}
        </Alert>
      )}
      <JobProgress />

      <Card title="Comprobar disco">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Relee todo lo guardado en el disco y lo compara con su huella (hash) del manifest, para detectar archivos dañados o que han
          desaparecido. Tarda tanto como leer todo el disco.
        </p>
        <Button variant="primary" className="mt-3" disabled={busy || !disk} onClick={t.runCheck}>Comprobar disco</Button>
        {t.check && (
          <div className="mt-3">
            {t.check.result.missing.length + t.check.result.damaged.length === 0 ? (
              <Alert tone="ok">Todo correcto: {t.check.result.ok} archivos comprobados sin ningún problema.</Alert>
            ) : (
              <Alert tone="error">
                <p className="font-medium">
                  {t.check.result.damaged.length} dañados y {t.check.result.missing.length} desaparecidos (de {t.check.result.checked}).
                </p>
                <p className="mt-1">
                  La app puede buscarlos en tus carpetas de origen y en otros discos de backup conectados, y volver a copiarlos.
                </p>
                <Button variant="primary" className="mt-2" disabled={busy} onClick={t.runRepair}>Volver a copiarlos</Button>
              </Alert>
            )}
            <EntryList title="Dañados" entries={t.check.result.damaged} />
            <EntryList title="Desaparecidos" entries={t.check.result.missing} />
          </div>
        )}
        {t.repair && (
          <Alert tone={t.repair.notFound.length || t.repair.failed.length ? 'warn' : 'ok'}>
            <p>Recuperados: {t.repair.repaired.length}. No encontrados en ningún sitio: {t.repair.notFound.length}. Fallidos: {t.repair.failed.length}.</p>
            {t.repair.notFound.length > 0 && <p className="mt-1">Los no encontrados quizá estén en otro disco: conéctalo y repite la comprobación.</p>}
          </Alert>
        )}
      </Card>

      <Card title="Explorar y restaurar">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Ver lo que hay en el disco por fecha, dispositivo o tipo, y copiar fotos de vuelta a una carpeta.
          {disk?.encrypted ? ' En este disco cifrado, al restaurar se descifran.' : ' (En un disco sin cifrar también puedes abrir las fotos directamente desde cualquier ordenador.)'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={!disk} onClick={() => go('explore')}>Abrir explorador</Button>
          {disk?.encrypted && <Button disabled={busy} onClick={t.runDecryptAll}>Descifrar todo el disco a una carpeta</Button>}
        </div>
      </Card>

      <FreeSpace />

      <Card title="Mantenimiento del manifest">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <b>Incorporar archivos sueltos</b>: registra fotos que están en el disco pero no en el manifest (copiadas a mano o desde los ZIP del
          modo compatible), para que no se vuelvan a copiar.
        </p>
        <Button className="mt-2" disabled={busy || !disk} onClick={t.runIncorporate}>Incorporar archivos sueltos</Button>
        {t.incorporate && (
          <p className="mt-2 text-sm">
            Incorporados: {t.incorporate.added}. Repetidos dentro del disco: {t.incorporate.duplicatesOnDisk.length}. Ilegibles: {t.incorporate.unreadable.length}.
          </p>
        )}
        <hr className="my-4 border-slate-200 dark:border-slate-800" />
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <b>Reconstruir manifest</b>: solo si el manifest y su copia (.bak) están dañados o se han perdido. Escanea el disco y vuelve a
          registrar todo lo que hay. Se pierden los nombres y rutas originales del origen, pero no ninguna foto, y se guarda una copia del
          manifest dañado.
        </p>
        <Button
          className="mt-2"
          disabled={busy || !disk}
          onClick={() => confirm('¿Reconstruir el manifest escaneando todo el disco? Úsalo solo si el actual está dañado.') && t.runRebuild()}
        >
          Reconstruir manifest
        </Button>
        {t.rebuild && <p className="mt-2 text-sm">Manifest reconstruido con {t.rebuild.total} archivos ({t.rebuild.added} añadidos).</p>}
      </Card>
    </>
  )
}
