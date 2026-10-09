import { useEffect, useMemo, useRef, useState } from 'react'
import { JobProgress } from '../components/JobProgress'
import { Alert, Button, Card, PageHeader } from '../components/ui'
import { formatBytes } from '../core/format'
import type { ManifestEntry } from '../core/manifest/schema'
import { ManifestStore } from '../core/manifest/store'
import { extOf, isVideo } from '../core/media'
import type { DiskRecord } from '../db'
import { io } from '../platform/io'
import { activeDisk, useApp } from '../state/app'
import { diskTarget } from '../state/keys'
import { readyDisk, useTools } from '../state/tools'

const SHOWABLE = ['jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'bmp', 'avif']
const PAGE = 60
const STATUS_LABEL = { verified: 'Verificado', unverified: 'No verificado', reduced: 'Posible versión reducida' } as const

function entryDate(e: ManifestEntry) {
  const d = new Date(e.exifDate ?? e.fileDate)
  return Number.isNaN(d.getTime()) ? null : d
}

function nameOf(e: ManifestEntry) {
  return e.originalName || e.diskPath.split('/').pop()!
}

/** Carga el contenido del archivo del disco para mostrarlo (descifrándolo si hace falta). */
async function previewUrl(disk: DiskRecord, e: ManifestEntry, size: number): Promise<{ url: string; video: boolean } | null> {
  const ext = extOf(nameOf(e))
  const video = isVideo(nameOf(e))
  if (video && disk.encrypted) return null // descifrar un vídeo entero solo para la miniatura sería muy lento
  if (!video && !SHOWABLE.includes(ext) && !['heic', 'heif'].includes(ext)) return null
  const blob = await diskTarget(disk).readFile(e.diskPath)
  if (!blob) return null
  if (ext === 'heic' || ext === 'heif') {
    const jpeg = await io.heicThumbnail(blob, size)
    return jpeg ? { url: URL.createObjectURL(jpeg), video: false } : null
  }
  return { url: URL.createObjectURL(blob), video }
}

function DiskThumb({ disk, entry, onOpen, selected, onToggle }: { disk: DiskRecord; entry: ManifestEntry; onOpen: () => void; selected: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<{ url: string; video: boolean } | null | 'none'>(null)
  useEffect(() => {
    let url: string | null = null
    let alive = true
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        obs.disconnect()
        previewUrl(disk, entry, 320)
          .then((r) => {
            if (!alive) {
              if (r) URL.revokeObjectURL(r.url)
              return
            }
            url = r?.url ?? null
            setSrc(r ?? 'none')
          })
          .catch(() => alive && setSrc('none'))
      },
      { rootMargin: '200px' },
    )
    obs.observe(el)
    return () => {
      alive = false
      obs.disconnect()
      if (url) URL.revokeObjectURL(url)
    }
  }, [disk, entry])

  return (
    <div ref={ref} className={`group relative aspect-square overflow-hidden rounded-lg bg-surface-2 ${selected ? 'ring-2 ring-[var(--accent)]' : ''}`}>
      <button className="absolute inset-0 h-full w-full" onClick={onOpen} title={nameOf(entry)} aria-label={`Ver ${nameOf(entry)}`}>
        {src && src !== 'none' ? (
          src.video ? (
            <video className="h-full w-full object-cover" src={src.url} muted preload="metadata" />
          ) : (
            <img className="h-full w-full object-cover" src={src.url} alt="" />
          )
        ) : (
          <span className="flex h-full items-center justify-center text-xs font-semibold uppercase text-muted">
            {src === null ? <span className="skeleton absolute inset-0" /> : isVideo(nameOf(entry)) ? 'vídeo' : extOf(nameOf(entry))}
          </span>
        )}
      </button>
      <input type="checkbox" className="absolute top-1 left-1 h-4 w-4 accent-[var(--accent)]" checked={selected} onChange={onToggle} aria-label="Seleccionar" />
      {entry.status !== 'verified' && <span className="absolute right-1 bottom-1 rounded bg-warn px-1 text-[10px] text-white">{entry.status === 'reduced' ? 'reducida' : 'no verif.'}</span>}
    </div>
  )
}

function Detail({ disk, entry, onClose }: { disk: DiskRecord; entry: ManifestEntry; onClose: () => void }) {
  const [src, setSrc] = useState<{ url: string; video: boolean } | null | undefined>(undefined)
  useEffect(() => {
    let url: string | null = null
    previewUrl(disk, entry, 1600).then((r) => {
      url = r?.url ?? null
      setSrc(r)
    }, () => setSrc(null))
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [disk, entry])
  const d = entryDate(entry)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal>
      <div className="max-h-full w-full max-w-3xl overflow-auto rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow-pop)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="font-semibold break-all">{nameOf(entry)}</h3>
          <Button variant="ghost" onClick={onClose}>✕</Button>
        </div>
        {src === undefined ? (
          <p className="text-sm text-muted">Cargando…</p>
        ) : src ? (
          src.video ? <video className="max-h-[60vh] w-full" src={src.url} controls /> : <img className="max-h-[60vh] w-full object-contain" src={src.url} alt="" />
        ) : (
          <p className="text-sm text-muted">No se puede previsualizar este archivo en el navegador.</p>
        )}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">Fecha</dt><dd>{d ? d.toLocaleString('es-ES') : 'Sin fecha'}{entry.exifDate ? ' (EXIF)' : ' (archivo)'}</dd>
          <dt className="text-muted">Tamaño</dt><dd>{formatBytes(entry.size)}</dd>
          <dt className="text-muted">Dispositivo</dt><dd>{entry.deviceName}</dd>
          <dt className="text-muted">Origen</dt><dd className="break-all">{entry.sourcePath || '—'}</dd>
          <dt className="text-muted">En el disco</dt><dd className="break-all">{entry.diskPath}</dd>
          <dt className="text-muted">Estado</dt><dd>{STATUS_LABEL[entry.status]}{entry.note ? ` · ${entry.note}` : ''}</dd>
          {entry.pair && <><dt className="text-muted">Live Photo</dt><dd>Tiene foto/vídeo emparejado</dd></>}
          {entry.motionPhoto && <><dt className="text-muted">Motion Photo</dt><dd>Incluye vídeo</dd></>}
          <dt className="text-muted">SHA-256</dt><dd className="break-all font-mono">{entry.hash}</dd>
        </dl>
        {src && (
          <Button className="mt-3" onClick={() => window.open(src.url, '_blank')}>Abrir a tamaño completo</Button>
        )}
      </div>
    </div>
  )
}

export function ExploreScreen() {
  const { diskStates } = useApp()
  const tools = useTools()
  const disk = activeDisk()
  const [entries, setEntries] = useState<ManifestEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')
  const [device, setDevice] = useState('')
  const [kind, setKind] = useState<'' | 'photo' | 'video'>('')
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<ManifestEntry | null>(null)
  const connected = disk && diskStates[disk.key]?.state === 'connected'

  useEffect(() => {
    if (!disk || !connected) return
    setEntries(null)
    setError(null)
    let d: DiskRecord
    try {
      d = readyDisk()
    } catch (err) {
      setError((err as Error).message)
      return
    }
    ManifestStore.open(diskTarget(d), d.diskId!)
      .then(({ store }) => setEntries(store.entries().sort((a, b) => (entryDate(b)?.getTime() ?? 0) - (entryDate(a)?.getTime() ?? 0))))
      .catch((err) => setError(`No se puede leer el manifest del disco: ${(err as Error).message}`))
  }, [disk?.key, connected, tools.restore])

  const options = useMemo(() => {
    const years = new Set<string>()
    const devices = new Set<string>()
    for (const e of entries ?? []) {
      const d = entryDate(e)
      years.add(d ? String(d.getFullYear()) : 'Sin fecha')
      devices.add(e.deviceName)
    }
    return { years: [...years].sort().reverse(), devices: [...devices].sort() }
  }, [entries])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (entries ?? []).filter((e) => {
      const d = entryDate(e)
      if (year && (d ? String(d.getFullYear()) : 'Sin fecha') !== year) return false
      if (month && (!d || String(d.getMonth() + 1) !== month)) return false
      if (device && e.deviceName !== device) return false
      if (kind && (isVideo(nameOf(e)) ? 'video' : 'photo') !== kind) return false
      if (status && e.status !== status) return false
      if (q && !nameOf(e).toLowerCase().includes(q) && !e.sourcePath.toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, year, month, device, kind, status, query])

  useEffect(() => setLimit(PAGE), [year, month, device, kind, status, query])

  if (!disk) return <Alert tone="warn">Conecta un disco de backup para explorarlo.</Alert>
  if (!connected) return <Alert tone="warn">El disco "{disk.name}" no está conectado.</Alert>
  if (error) return <Alert tone="error">{error}</Alert>
  if (!entries) return <p className="text-muted">Leyendo el manifest…</p>

  const toggle = (h: string) => {
    const s = new Set(selected)
    if (s.has(h)) s.delete(h)
    else s.add(h)
    setSelected(s)
  }
  const sel = (entries ?? []).filter((e) => selected.has(e.hash))
  const select = 'field py-1'

  return (
    <>
      <JobProgress />
      {tools.restore && (
        <Alert tone={tools.restore.failed.length ? 'warn' : 'ok'} onClose={() => useTools.setState({ restore: null })}>
          Restaurados {tools.restore.restored} archivos en "{tools.restore.folder}".
          {tools.restore.failed.length > 0 && ` ${tools.restore.failed.length} no se han podido restaurar: ${tools.restore.failed.slice(0, 3).map((f) => f.path).join(', ')}…`}
        </Alert>
      )}
      {tools.error && <Alert tone="error" onClose={() => useTools.setState({ error: null })}>{tools.error}</Alert>}

      <PageHeader title="Explorar el backup" subtitle={`${disk.name} · ${entries.length} archivos`} />
      <Card>
        <div className="flex flex-wrap gap-2">
          <select className={select} value={year} onChange={(e) => setYear(e.target.value)} aria-label="Año">
            <option value="">Todos los años</option>
            {options.years.map((y) => <option key={y}>{y}</option>)}
          </select>
          <select className={select} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mes">
            <option value="">Todos los meses</option>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2000, i, 1).toLocaleString('es-ES', { month: 'long' })}</option>)}
          </select>
          <select className={select} value={device} onChange={(e) => setDevice(e.target.value)} aria-label="Dispositivo">
            <option value="">Todos los dispositivos</option>
            {options.devices.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select className={select} value={kind} onChange={(e) => setKind(e.target.value as '' | 'photo' | 'video')} aria-label="Tipo">
            <option value="">Fotos y vídeos</option>
            <option value="photo">Solo fotos</option>
            <option value="video">Solo vídeos</option>
          </select>
          <select className={select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado">
            <option value="">Cualquier estado</option>
            <option value="verified">Verificados</option>
            <option value="unverified">No verificados</option>
            <option value="reduced">Posibles versiones reducidas</option>
          </select>
          <input className={`${select} min-w-0 flex-1`} placeholder="Buscar por nombre" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{filtered.length} resultados · {formatBytes(filtered.reduce((a, e) => a + e.size, 0))}</span>
          <Button className="px-3 py-1 text-xs" disabled={!sel.length || !!tools.job} onClick={() => tools.runRestore(sel)}>
            Restaurar seleccionadas ({sel.length})
          </Button>
          <Button className="px-3 py-1 text-xs" disabled={!filtered.length || !!tools.job} onClick={() => confirm(`¿Restaurar ${filtered.length} archivos (${formatBytes(filtered.reduce((a, e) => a + e.size, 0))}) a una carpeta?`) && tools.runRestore(filtered)}>
            Restaurar todo lo filtrado
          </Button>
          {sel.length > 0 && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setSelected(new Set())}>Quitar selección</Button>}
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {filtered.slice(0, limit).map((e) => (
          <DiskThumb key={e.hash} disk={disk} entry={e} onOpen={() => setOpen(e)} selected={selected.has(e.hash)} onToggle={() => toggle(e.hash)} />
        ))}
      </div>
      {filtered.length > limit && <Button onClick={() => setLimit(limit + PAGE)}>Ver más ({filtered.length - limit} restantes)</Button>}
      {open && <Detail disk={disk} entry={open} onClose={() => setOpen(null)} />}
    </>
  )
}
