import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatBytes } from '../core/format'
import { extOf, isVideo } from '../core/media'
import { io } from '../platform/io'
import { Button } from './ui'
import { Dialog } from './Dialog'

export interface MediaItem {
  name: string
  size: number
  sourcePath: string
  diskPath?: string
}

/** Devuelve el contenido del archivo (del origen o del disco), o null si no está disponible. */
export type BlobGetter = (item: MediaItem) => Promise<Blob | null>

const PAGE = 60
const THUMB = 480
const HEIF = ['heic', 'heif']

/**
 * Miniatura reducida fuera del hilo principal (createImageBitmap con
 * redimensionado): no se guarda en memoria la foto a tamaño completo.
 */
async function thumbBitmap(blob: Blob, name: string) {
  if (HEIF.includes(extOf(name))) {
    const jpeg = await io.heicThumbnail(blob, THUMB)
    return jpeg ? createImageBitmap(jpeg) : null
  }
  return createImageBitmap(blob, { resizeWidth: THUMB, resizeQuality: 'medium' })
}

function Tile({ item, getBlob, onOpen }: { item: MediaItem; getBlob: BlobGetter; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'image' | 'video' | 'none'>('loading')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const video = isVideo(item.name)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    let url: string | null = null
    const obs = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        obs.disconnect()
        void (async () => {
          const blob = await getBlob(item)
          if (!alive) return
          if (!blob) return setState('none')
          if (video) {
            url = URL.createObjectURL(blob)
            setVideoUrl(url)
            return setState('video')
          }
          const bmp = await thumbBitmap(blob, item.name)
          if (!alive || !bmp || !canvas.current) {
            bmp?.close()
            if (alive) setState('none')
            return
          }
          canvas.current.width = bmp.width
          canvas.current.height = bmp.height
          canvas.current.getContext('bitmaprenderer')!.transferFromImageBitmap(bmp)
          setState('image')
        })().catch(() => alive && setState('none'))
      },
      { rootMargin: '400px' },
    )
    obs.observe(el)
    return () => {
      alive = false
      obs.disconnect()
      if (url) URL.revokeObjectURL(url)
    }
  }, [item, getBlob, video])

  return (
    <button ref={ref} type="button" onClick={onOpen} title={item.name} aria-label={`Ver ${item.name}`} className="group relative aspect-square overflow-hidden rounded-xl bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
      <canvas ref={canvas} className={`h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] ${state === 'image' ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
      {state === 'video' && videoUrl && <video className="absolute inset-0 h-full w-full object-cover" src={`${videoUrl}#t=0.1`} muted preload="metadata" />}
      {state === 'loading' && <span className="skeleton absolute inset-0" />}
      {state === 'none' && <span className="absolute inset-0 grid place-items-center text-xs font-semibold uppercase text-muted">{video ? 'vídeo' : extOf(item.name) || '?'}</span>}
      {video && (
        <span className="absolute right-1.5 bottom-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
          <Play size={12} fill="currentColor" aria-hidden />
        </span>
      )}
    </button>
  )
}

/** Visor a pantalla completa: flechas, teclado (← →, Esc) y deslizar en el móvil. */
function Viewer({ items, index, onIndex, onClose, getBlob }: { items: MediaItem[]; index: number; onIndex: (i: number) => void; onClose: () => void; getBlob: BlobGetter }) {
  const item = items[index]
  const [src, setSrc] = useState<{ url: string; video: boolean } | null | undefined>(undefined)
  const startX = useRef<number | null>(null)
  const swiped = useRef(false)
  const prev = () => index > 0 && onIndex(index - 1)
  const next = () => index < items.length - 1 && onIndex(index + 1)

  useEffect(() => {
    let alive = true
    let url: string | null = null
    setSrc(undefined)
    void (async () => {
      let blob = await getBlob(item)
      if (blob && HEIF.includes(extOf(item.name))) blob = await io.heicThumbnail(blob, 2400)
      if (!alive) return
      if (!blob) return setSrc(null)
      url = URL.createObjectURL(blob)
      setSrc({ url, video: isVideo(item.name) })
    })().catch(() => alive && setSrc(null))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [item, getBlob])

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') prev()
        if (e.key === 'ArrowRight') next()
      }}
    >
      <header className="flex items-center gap-3 px-4 py-3 text-sm">
        <span className="tabular-nums text-white/70">
          {index + 1} / {items.length}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
        <button type="button" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10" onClick={onClose} aria-label="Cerrar" autoFocus>
          <X size={20} aria-hidden />
        </button>
      </header>

      <div
        className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-2 select-none sm:px-16"
        onClick={(e) => {
          // Clic en la zona oscura (no tras deslizar): cerrar.
          if (e.target === e.currentTarget && !swiped.current) onClose()
          swiped.current = false
        }}
        onPointerDown={(e) => (startX.current = e.clientX)}
        onPointerUp={(e) => {
          if (startX.current === null) return
          const dx = e.clientX - startX.current
          startX.current = null
          swiped.current = Math.abs(dx) > 60
          if (dx > 60) prev()
          else if (dx < -60) next()
        }}
      >
        {src === undefined ? (
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-label="Cargando" />
        ) : src ? (
          src.video ? (
            <video key={src.url} className="max-h-full max-w-full rounded-lg" src={src.url} controls autoPlay playsInline />
          ) : (
            <img key={src.url} className="animate-rise max-h-full max-w-full rounded-lg object-contain" src={src.url} alt={item.name} decoding="async" draggable={false} />
          )
        ) : (
          <p className="max-w-sm text-center text-sm text-white/70">No se puede mostrar este archivo aquí (formato que el navegador no abre, o el archivo ya no está disponible).</p>
        )}
        {index > 0 && (
          <button type="button" className="absolute left-2 hidden h-11 w-11 place-items-center rounded-full bg-white/10 backdrop-blur hover:bg-white/20 sm:grid" onClick={prev} aria-label="Anterior">
            <ChevronLeft size={22} aria-hidden />
          </button>
        )}
        {index < items.length - 1 && (
          <button type="button" className="absolute right-2 hidden h-11 w-11 place-items-center rounded-full bg-white/10 backdrop-blur hover:bg-white/20 sm:grid" onClick={next} aria-label="Siguiente">
            <ChevronRight size={22} aria-hidden />
          </button>
        )}
      </div>

      <footer className="space-y-0.5 px-4 py-3 text-xs text-white/70">
        <div>
          {formatBytes(item.size)} · Origen: <span className="break-all">{item.sourcePath}</span>
        </div>
        {item.diskPath && (
          <div>
            En el disco: <span className="break-all text-white">{item.diskPath}</span>
          </div>
        )}
      </footer>
    </div>
  )
}

/** Cuadrícula de fotos y vídeos con carga diferida y visor a pantalla completa. */
export function Gallery({ items: all, getBlob }: { items: MediaItem[]; getBlob: BlobGetter }) {
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<number | null>(null)
  const [kind, setKind] = useState<'all' | 'photo' | 'video'>('all')
  const videos = all.filter((i) => isVideo(i.name)).length
  const items = kind === 'all' ? all : all.filter((i) => isVideo(i.name) === (kind === 'video'))
  if (all.length === 0) return null
  const chip = (k: typeof kind, label: string, n: number) => (
    <button
      type="button"
      onClick={() => {
        setKind(k)
        setLimit(PAGE)
      }}
      aria-pressed={kind === k}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${kind === k ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line hover:bg-surface-2'}`}
    >
      {label} <span className="tabular-nums text-muted">{n}</span>
    </button>
  )
  return (
    <>
      {videos > 0 && videos < all.length && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filtrar">
          {chip('all', 'Todo', all.length)}
          {chip('photo', 'Fotos', all.length - videos)}
          {chip('video', 'Vídeos', videos)}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-6">
        {items.slice(0, limit).map((it, i) => (
          <Tile key={it.sourcePath + (it.diskPath ?? '')} item={it} getBlob={getBlob} onOpen={() => setOpen(i)} />
        ))}
      </div>
      {items.length > limit && (
        <Button className="mt-3" onClick={() => setLimit(limit + PAGE * 2)}>
          Ver más ({items.length - limit} restantes)
        </Button>
      )}
      <Dialog open={open !== null} onClose={() => setOpen(null)} title="Visor de fotos" className="viewer">
        {open !== null && <Viewer items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} getBlob={getBlob} />}
      </Dialog>
    </>
  )
}
