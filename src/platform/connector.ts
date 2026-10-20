// Conector de BackupFotos.exe: Windows no deja a una web recorrer un móvil
// conectado por cable, pero el programa sí (como el Explorador). Mientras
// está abierto, sirve el móvil en 127.0.0.1 (solo este PC) y solo a esta web.
// Todo lo demás —análisis, copia, verificación, informe— lo hace la web.

import type { ScanResult } from '../core/backup/engine'
import { CancelledError, type RunControl, type SourceFile } from '../core/types'

export const CONNECTOR_URL = 'http://127.0.0.1:47613'
export const CONNECTOR_DOWNLOAD = 'https://github.com/CristianRubio4/backup-fotos/releases/latest/download/BackupFotos.exe'

export interface CableDevice {
  id: string
  name: string
}

export interface ConnectorInfo {
  version: string
  devices: CableDevice[]
}

/** ¿Está abierto el programa? Devuelve los móviles conectados, o null si no responde. */
export async function connectorInfo(timeoutMs = 2500): Promise<ConnectorInfo | null> {
  try {
    const res = await fetch(`${CONNECTOR_URL}/v1/info`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { app?: string; version?: string; devices?: CableDevice[] }
    return data.app === 'backup-fotos-conector' ? { version: data.version ?? '', devices: data.devices ?? [] } : null
  } catch {
    return null
  }
}

const fileUrl = (device: string, path: string) => `${CONNECTOR_URL}/v1/file?device=${encodeURIComponent(device)}&path=${encodeURIComponent(path)}`

/** Mensaje en español cuando el programa no responde a mitad. */
export const CONNECTOR_GONE =
  'El programa BackupFotos.exe no responde: comprueba que sigue abierto y que el móvil está conectado y desbloqueado.'

async function readFile(device: string, path: string): Promise<Blob> {
  let res: Response
  try {
    res = await fetch(fileUrl(device, path), { cache: 'no-store' })
  } catch {
    throw new DOMException(CONNECTOR_GONE, 'NotReadableError')
  }
  if (!res.ok) throw new DOMException((await res.text().catch(() => '')) || `Error ${res.status} al leer del móvil`, res.status === 404 ? 'NotFoundError' : 'NotReadableError')
  return res.blob()
}

/**
 * Recorre el móvil entero (todas sus carpetas, lo hace el programa) y devuelve
 * sus fotos y vídeos como archivos de origen. `label` es el primer tramo de la ruta.
 */
export async function scanCable(device: CableDevice, label: string, control: RunControl, onFound: (count: number) => void, baseCount = 0, opts: { skipSent?: boolean } = {}): Promise<ScanResult & { name: string; sent: { count: number; bytes: number } }> {
  const ctl = new AbortController()
  let res: Response
  try {
    res = await fetch(`${CONNECTOR_URL}/v1/scan?device=${encodeURIComponent(device.id)}`, { cache: 'no-store', signal: ctl.signal })
  } catch {
    throw new Error(CONNECTOR_GONE)
  }
  if (!res.ok || !res.body) throw new Error((await res.text().catch(() => '')) || CONNECTOR_GONE)

  const files: SourceFile[] = []
  const ignored: string[] = []
  const unreadable: Array<{ relPath: string; reason: string }> = []
  let dirs: string[] = []
  /** Lo enviado por WhatsApp (carpetas Sent): se mide siempre, se copia solo si se quiere. */
  const sent = { count: 0, bytes: 0 }
  let name = device.name
  let done = false
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  const rel = (p: string) => `${label}/${p}`
  const handle = (line: string) => {
    if (!line.trim()) return
    const m = JSON.parse(line) as Record<string, unknown>
    switch (m.t) {
      case 'start':
        name = String(m.name ?? name)
        break
      case 'dir':
        onFound(baseCount + Number(m.found ?? 0))
        break
      case 'file': {
        const path = String(m.path)
        const size = Number(m.size)
        const mtime = Number(m.mtime) || 0
        const isSent = m.sent === true || /(^|\/)WhatsApp [^/]+\/Sent\//i.test(path)
        if (isSent) {
          sent.count++
          sent.bytes += size
          if (opts.skipSent) break
        }
        files.push({
          relPath: rel(path),
          name: String(m.name),
          size,
          lastModified: mtime,
          getFile: () => readFile(device.id, path),
          // Caché de hashes: mismo móvil, misma ruta, tamaño y fecha → no se vuelve a leer para deduplicar.
          cacheKey: `cable:${device.id}:${path}`,
        })
        if (files.length % 200 === 0) onFound(baseCount + files.length)
        break
      }
      case 'ignored':
        ignored.push(rel(String(m.path)))
        break
      case 'error':
        unreadable.push({ relPath: rel(String(m.path)), reason: String(m.reason) })
        break
      case 'fail':
        throw new Error(`No se ha podido recorrer el móvil: ${String(m.reason)}`)
      case 'done': {
        // Las carpetas vienen con el nombre del móvil delante: se pone la etiqueta del origen.
        const device = String(m.name ?? name)
        dirs = ((m.dirs as string[]) ?? []).map((d) => (d.startsWith(device) ? label + d.slice(device.length) : d))
        done = true
        break
      }
    }
  }
  try {
    for (;;) {
      await control.checkpoint()
      const { value, done: end } = await reader.read()
      if (end) break
      buf += value
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        handle(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
    }
    handle(buf)
  } catch (err) {
    ctl.abort()
    if (err instanceof CancelledError || (err as Error)?.name === 'CancelledError') throw err
    throw err instanceof SyntaxError ? new Error(CONNECTOR_GONE) : err
  }
  if (!done) throw new Error(CONNECTOR_GONE)
  onFound(baseCount + files.length)
  return { files, ignored, unreadable, dirs, name, sent }
}
