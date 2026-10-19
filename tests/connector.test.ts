import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBackup } from '../src/core/backup/engine'
import { Controller, noControl } from '../src/core/control'
import { CONNECTOR_URL, connectorInfo, scanCable } from '../src/platform/connector'
import { DEFAULT_SETTINGS } from './test-settings'
import { MemoryTarget, testHasher } from './fakes'

// Simula BackupFotos.exe: responde como el conector real (ver desktop/BackupFotos.Core/Connector.cs).
function fakeConnector(phone: Record<string, string>, opts: { name?: string; chunkSize?: number; failAfterLines?: number } = {}) {
  const name = opts.name ?? 'Galaxy S23'
  const lines = [
    { t: 'start', name },
    { t: 'dir', path: 'Interno/DCIM', dirs: 5, found: 1 },
    ...Object.entries(phone).map(([path, content]) => ({ t: 'file', path, name: path.split('/').pop(), size: new TextEncoder().encode(content).byteLength, mtime: 1715941800000 })),
    { t: 'ignored', path: 'Interno/Download/doc.pdf' },
    { t: 'error', path: 'Interno/Privada', reason: 'Acceso denegado' },
    { t: 'done', name, dirs: [`${name} · vacía`, `${name}/Interno/DCIM/Camera · 2 fotos y vídeos de 2 archivos`], found: Object.keys(phone).length },
  ]
  const text = lines.slice(0, opts.failAfterLines ?? lines.length).map((l) => JSON.stringify(l) + '\n').join('')
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input)
    calls.push(url.pathname)
    if (url.origin !== CONNECTOR_URL) throw new TypeError('fetch failed')
    if (url.pathname === '/v1/info') return Response.json({ app: 'backup-fotos-conector', version: '1.0.5', devices: [{ id: 'dev-0', name }] })
    if (url.pathname === '/v1/scan') {
      // Llega en trozos arbitrarios, como por la red (las líneas pueden partirse).
      const bytes = new TextEncoder().encode(text)
      const size = opts.chunkSize ?? 7
      let i = 0
      return new Response(
        new ReadableStream({
          pull(c) {
            if (i >= bytes.length) return c.close()
            c.enqueue(bytes.slice(i, (i += size)))
          },
        }),
      )
    }
    if (url.pathname === '/v1/file') {
      const path = url.searchParams.get('path')!
      return path in phone ? new Response(phone[path]) : new Response('No está en el móvil', { status: 404 })
    }
    return new Response('No existe', { status: 404 })
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('móvil por cable (a través de BackupFotos.exe)', () => {
  it('detecta el programa y sus móviles; si no está abierto, null', async () => {
    fakeConnector({})
    expect(await connectorInfo()).toEqual({ version: '1.0.5', devices: [{ id: 'dev-0', name: 'Galaxy S23' }] })
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await connectorInfo()).toBeNull()
  })

  it('recibe el escaneo completo aunque llegue a trozos, y lee cada archivo', async () => {
    const phone = { 'Interno/DCIM/Camera/IMG_1.jpg': 'foto 1', 'Interno/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/IMG-WA 1.jpg': 'wa', 'SD/DCIM/VID_1.mp4': 'vídeo' }
    fakeConnector(phone)
    const found: number[] = []
    const r = await scanCable({ id: 'dev-0', name: 'Galaxy S23' }, 'Galaxy S23', noControl, (n) => found.push(n))
    expect(r.name).toBe('Galaxy S23')
    expect(r.files.map((f) => f.relPath)).toEqual(Object.keys(phone).map((p) => `Galaxy S23/${p}`))
    expect(r.ignored).toEqual(['Galaxy S23/Interno/Download/doc.pdf'])
    expect(r.unreadable).toEqual([{ relPath: 'Galaxy S23/Interno/Privada', reason: 'Acceso denegado' }])
    expect(r.dirs).toContain('Galaxy S23/Interno/DCIM/Camera · 2 fotos y vídeos de 2 archivos')
    expect(found.at(-1)).toBe(3)
    const wa = r.files[1]
    expect(await (await wa.getFile()).text()).toBe('wa')
    expect(wa.lastModified).toBe(1715941800000)
  })

  it('si el programa se cierra a mitad del escaneo, se avisa (no se da por bueno un escaneo incompleto)', async () => {
    fakeConnector({ 'DCIM/a.jpg': 'a', 'DCIM/b.jpg': 'b' }, { failAfterLines: 3 })
    await expect(scanCable({ id: 'dev-0', name: 'X' }, 'X', noControl, () => {})).rejects.toThrow(/BackupFotos.exe no responde/)
  })

  it('backup completo desde el móvil por cable: la carpeta lleva el nombre del móvil', async () => {
    const phone = { 'Interno/DCIM/Camera/IMG_1.jpg': 'foto uno', 'Interno/DCIM/Camera/IMG_2.jpg': 'foto dos', 'SD/DCIM/VID_1.mp4': 'vídeo' }
    fakeConnector(phone, { name: 'Pixel 8' })
    const t = new MemoryTarget()
    let name: string | null = null
    const r = await runBackup({
      target: t,
      diskName: 'USB',
      scan: async (onFound) => {
        const s = await scanCable({ id: 'dev-0', name: 'Pixel 8' }, 'Pixel 8', noControl, onFound)
        name = s.name
        return s
      },
      sourceName: () => name,
      openRunFolder: async (n) => t.child(n),
      hasher: testHasher,
      readExif: async () => ({ date: null }),
      device: { id: 'pc', name: 'PC' },
      settings: { ...DEFAULT_SETTINGS, runFolder: true },
      control: new Controller(),
      onProgress: () => {},
      now: () => new Date(2026, 9, 19, 17, 5),
    })
    expect(r.outcome).toBe('completed')
    expect(r.folder).toBe('Pixel 8 - 2026-10-19 17h05')
    expect(r.copied).toHaveLength(3)
    expect(t.mediaPaths().every((p) => p.startsWith('Pixel 8 - 2026-10-19 17h05/'))).toBe(true)
    expect(r.searched?.count).toBe(2)
  })
})
