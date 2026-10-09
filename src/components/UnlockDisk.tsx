import { useState } from 'react'
import { readDiskId } from '../core/disk'
import type { DiskRecord } from '../db'
import { FsaTarget } from '../platform/fsa-target'
import { io } from '../platform/io'
import { setDiskKeys } from '../state/keys'
import { Button } from './ui'

/** Desbloqueo de un disco cifrado con su contraseña (la clave solo se guarda en memoria). */
export function UnlockDisk({ disk }: { disk: DiskRecord }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const info = await readDiskId(new FsaTarget(disk.handle))
      if (!info?.encryption) throw new Error('No se encuentran los datos de cifrado del disco')
      const keys = await io.unlock(password, info.encryption)
      setDiskKeys(info.id, keys)
      setPassword('')
    } catch (err) {
      setError((err as Error).name === 'WrongPasswordError' ? 'Contraseña incorrecta.' : (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <label className="sr-only" htmlFor={`pw-${disk.key}`}>Contraseña de {disk.name}</label>
      <input
        id={`pw-${disk.key}`}
        type="password"
        autoComplete="current-password"
        className="field min-w-0 flex-1"
        placeholder="Contraseña del disco cifrado"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={busy || !password}>{busy ? 'Comprobando…' : 'Desbloquear'}</Button>
      {error && <p className="w-full text-xs text-danger" role="alert">{error}</p>}
    </form>
  )
}
