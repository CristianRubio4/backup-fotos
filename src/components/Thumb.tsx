import { useEffect, useState } from 'react'
import { extOf, isVideo } from '../core/media'
import type { SourceFile } from '../core/types'

// Extensiones que el navegador puede mostrar en <img>.
const SHOWABLE = ['jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'bmp', 'avif']

/** Miniatura de un archivo de origen (se crea al mostrarse y se libera al ocultarse). */
export function Thumb({ file, size = 56 }: { file: SourceFile | undefined; size?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const ext = file ? extOf(file.name) : ''
  const video = file ? isVideo(file.name) : false
  const showable = video || SHOWABLE.includes(ext)

  useEffect(() => {
    if (!file || !showable || file.size === 0) return
    let u: string | null = null
    let alive = true
    file
      .getFile()
      .then((blob) => {
        if (!alive) return
        u = URL.createObjectURL(blob)
        setUrl(u)
      })
      .catch(() => setFailed(true))
    return () => {
      alive = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [file, showable])

  const box = 'shrink-0 overflow-hidden rounded-lg bg-surface-2'
  const style = { width: size, height: size }
  if (!url || failed) {
    return (
      <div className={`${box} flex items-center justify-center text-[10px] font-semibold uppercase text-muted`} style={style}>
        {failed ? '!' : video ? 'vídeo' : ext || '?'}
      </div>
    )
  }
  return video ? (
    <video className={`${box} object-cover`} style={style} src={url} muted preload="metadata" onError={() => setFailed(true)} />
  ) : (
    <img className={`${box} object-cover`} style={style} src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
  )
}
