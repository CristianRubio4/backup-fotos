import { useEffect, useMemo, useState } from 'react'
import { Thumb } from '../components/Thumb'
import { Alert, Button, Card, Toggle } from '../components/ui'
import { formatBytes } from '../core/format'
import { activeDisk, useApp } from '../state/app'
import { useFree } from '../state/free'
import { useTools } from '../state/tools'

const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)
const CONFIRM_WORD = 'BORRAR'
const SHOW = 120

export function FreeSpace() {
  const { running } = useApp()
  const { job } = useTools()
  const { scan, result, runScan, runDelete, reset } = useFree()
  const [twoDisks, setTwoDisks] = useState(true)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [typed, setTyped] = useState('')
  const [shown, setShown] = useState(SHOW)
  const disk = activeDisk()
  const busy = running || !!job

  useEffect(() => {
    setExcluded(new Set())
    setTyped('')
    setShown(SHOW)
  }, [scan])

  const pool = useMemo(() => (scan?.candidates ?? []).filter((c) => !twoDisks || c.disks.length >= 2), [scan, twoDisks])
  const chosen = pool.filter((c) => !excluded.has(c.file.relPath))
  const bytes = chosen.reduce((a, c) => a + c.file.size, 0)
  const multi = (scan?.candidates ?? []).filter((c) => c.disks.length >= 2).length

  if (isIOS) {
    return (
      <Card title="Liberar espacio">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          En iPhone y iPad una web no puede borrar fotos de la Fototeca. Cuando tengas el backup hecho y comprobado, bórralas desde la app Fotos.
        </p>
      </Card>
    )
  }

  return (
    <Card title="Liberar espacio">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Borra de las carpetas de origen las fotos que ya están <b>verificadas</b> en el backup (su copia se comprobó por hash). Nunca se ofrecen
        las "no verificadas" ni las "posibles versiones reducidas". Justo antes de borrar cada foto se vuelve a comprobar su copia.
      </p>
      {!scan && !result && (
        <Button className="mt-3" disabled={busy || !disk} onClick={runScan}>Buscar fotos que ya están a salvo</Button>
      )}

      {result && (
        <div className="mt-3 space-y-2">
          <Alert tone={result.skipped.length ? 'warn' : 'ok'}>
            Liberados {formatBytes(result.bytes)} ({result.deleted.length} archivos).
            {result.skipped.length > 0 && ` ${result.skipped.length} no se han borrado por seguridad: ${result.skipped.slice(0, 3).map((s) => `${s.candidate.file.relPath} (${s.reason})`).join('; ')}…`}
          </Alert>
          <p className="text-xs text-slate-500">Lo borrado queda anotado en Historial.</p>
          <Button variant="ghost" onClick={reset}>Cerrar</Button>
        </div>
      )}

      {scan && (
        <div className="mt-3 space-y-3">
          {scan.skippedSources.length > 0 && <Alert tone="warn">Sin permiso de escritura (no se revisan): {scan.skippedSources.join(', ')}.</Alert>}
          <p className="text-sm">
            En "{scan.diskName}": <b>{scan.candidates.length}</b> archivos verificados se pueden borrar del origen ({multi} están en 2 o más discos).
            No se ofrecen: {scan.unverified.length} no verificados, {scan.reduced.length} posibles versiones reducidas y {scan.notBackedUp} que no están en este backup.
          </p>
          <Toggle
            label="Solo los que están en al menos 2 discos distintos"
            hint="Recomendado: si un disco falla, sigue habiendo otra copia."
            checked={twoDisks}
            onChange={setTwoDisks}
          />
          {pool.length === 0 ? (
            <Alert tone="info">{twoDisks ? 'Ningún archivo está todavía en dos discos. Haz el backup también en otro disco, o desactiva la opción.' : 'No hay nada que liberar.'}</Alert>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b>{chosen.length} seleccionados · {formatBytes(bytes)}</b>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setExcluded(new Set())}>Todos</Button>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setExcluded(new Set(pool.map((c) => c.file.relPath)))}>Ninguno</Button>
              </div>
              <ul className="grid max-h-[28rem] grid-cols-1 gap-2 overflow-auto sm:grid-cols-2">
                {pool.slice(0, shown).map((c) => {
                  const on = !excluded.has(c.file.relPath)
                  return (
                    <li key={c.file.relPath}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-rose-600"
                          checked={on}
                          onChange={() => {
                            const s = new Set(excluded)
                            if (on) s.add(c.file.relPath)
                            else s.delete(c.file.relPath)
                            setExcluded(s)
                          }}
                        />
                        <Thumb file={c.file} size={48} />
                        <span className="min-w-0 text-xs">
                          <span className="block truncate font-medium" title={c.file.relPath}>{c.file.relPath}</span>
                          <span className="text-slate-500">{formatBytes(c.file.size)} · en {c.disks.length} {c.disks.length === 1 ? 'disco' : 'discos'}: {c.disks.join(', ')}</span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              {pool.length > shown && <Button variant="ghost" onClick={() => setShown(shown + SHOW)}>Ver más ({pool.length - shown})</Button>}
              <div className="rounded-xl border border-rose-300 p-3 dark:border-rose-900">
                <p className="text-sm">
                  Se borrarán <b>{chosen.length}</b> archivos ({formatBytes(bytes)}) de las carpetas de origen. Esta acción no se puede deshacer
                  desde la app (según el sistema, puede que tampoco vayan a la papelera). Escribe <b>{CONFIRM_WORD}</b> para confirmar:
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-800" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={`Escribe ${CONFIRM_WORD}`} />
                  <Button variant="danger" disabled={busy || typed !== CONFIRM_WORD || chosen.length === 0} onClick={() => runDelete(chosen)}>
                    Borrar {chosen.length} archivos del origen
                  </Button>
                  <Button variant="ghost" onClick={reset}>Cancelar</Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
