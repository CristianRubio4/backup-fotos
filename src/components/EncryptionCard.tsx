import { useState } from 'react'
import { isDiskEmpty, setDiskEncryption } from '../core/disk'
import type { DiskRecord } from '../db'
import { FsaTarget } from '../platform/fsa-target'
import { io } from '../platform/io'
import { useApp } from '../state/app'
import { forgetDiskKeys, isLocked, setDiskKeys, useKeys } from '../state/keys'
import { Alert, Button, Card } from './ui'

const MIN_LENGTH = 10

function EnableForm({ disk, onDone }: { disk: DiskRecord; onDone: () => void }) {
  const { updateDisk } = useApp()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = pw.length >= MIN_LENGTH && pw === pw2 && ack

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const target = new FsaTarget(disk.handle)
      if (!(await isDiskEmpty(target))) throw new Error('El disco ya tiene fotos o un manifest. El cifrado solo se puede activar en un disco (o carpeta) vacío.')
      const { params, keys } = await io.createEncryption(pw)
      await setDiskEncryption(target, params)
      if (disk.diskId) setDiskKeys(disk.diskId, keys)
      await updateDisk(disk.key, { encrypted: true })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="mt-3 space-y-3 rounded-xl border border-amber-300 p-3 dark:border-amber-800"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Alert tone="warn">
        <ul className="list-disc space-y-1 pl-4">
          <li>Las fotos cifradas <b>no se pueden abrir sin esta app</b> y la contraseña (ni desde otro ordenador, ni con otro programa).</li>
          <li>
            <b>Si olvidas la contraseña, las fotos de este disco se pierden para siempre.</b> Nadie puede recuperarlas, tampoco quien hizo la app.
          </li>
          <li>Apúntala en un lugar seguro (un gestor de contraseñas o papel guardado en otro sitio).</li>
          <li>Recomendación: cifra solo el disco que guardas fuera de casa y mantén otro sin cifrar.</li>
        </ul>
      </Alert>
      <input type="password" autoComplete="new-password" className="field w-full" placeholder={`Contraseña (mínimo ${MIN_LENGTH} caracteres)`} value={pw} onChange={(e) => setPw(e.target.value)} />
      <input type="password" autoComplete="new-password" className="field w-full" placeholder="Repite la contraseña" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      {pw2 && pw !== pw2 && <p className="text-xs text-rose-600">Las contraseñas no coinciden.</p>}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 accent-amber-600" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        Entiendo que si olvido la contraseña perderé las fotos de este disco.
      </label>
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!valid || busy}>{busy ? 'Preparando… (unos segundos)' : 'Cifrar este disco'}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  )
}

/** Ajustes → cifrado opcional por disco. */
export function EncryptionCard() {
  const { disks, diskStates } = useApp()
  useKeys() // se vuelve a dibujar al desbloquear o bloquear
  const [enabling, setEnabling] = useState<string | null>(null)

  return (
    <Card title="Cifrado (opcional)">
      <p className="text-sm text-muted">
        Cifra todo lo que se guarda en un disco con una contraseña (AES-256-GCM, clave derivada con Argon2id). Los nombres de archivo y el
        manifest tampoco quedan legibles. Desactivado por defecto; se elige por disco y solo en un disco vacío.
      </p>
      {disks.length === 0 && <p className="mt-2 text-sm text-muted">Añade primero un disco en Inicio.</p>}
      <ul className="mt-3 space-y-2">
        {disks.map((d) => {
          const connected = diskStates[d.key]?.state === 'connected'
          return (
            <li key={d.key} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{d.name}</span>
                {d.encrypted ? (
                  <span className="flex items-center gap-2 text-sm">
                    {isLocked(d) ? 'Cifrado · bloqueado' : 'Cifrado · desbloqueado'}
                    {!isLocked(d) && d.diskId && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => forgetDiskKeys(d.diskId!)}>Bloquear</Button>}
                  </span>
                ) : (
                  <Button className="px-3 py-1 text-xs" disabled={!connected || enabling === d.key} onClick={() => setEnabling(d.key)}>
                    {connected ? 'Cifrar este disco' : 'Conecta el disco para cifrarlo'}
                  </Button>
                )}
              </div>
              {enabling === d.key && <EnableForm disk={d} onDone={() => setEnabling(null)} />}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
