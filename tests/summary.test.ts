import { describe, expect, it } from 'vitest'
import { runBackup, type PreSummary } from '../src/core/backup/engine'
import { Controller } from '../src/core/control'
import type { HashCache } from '../src/core/types'
import { DEFAULT_SETTINGS } from './test-settings'
import { MemoryTarget, src, testHasher } from './fakes'

const MAY = new Date(2024, 4, 17, 10, 30).getTime()

function setup() {
  const t = new MemoryTarget()
  const cache = new Map<string, string>()
  const hashCache: HashCache = { get: async (f) => cache.get(f.relPath), set: async (f, h) => void cache.set(f.relPath, h) }
  const base = (now: Date) => ({
    target: t,
    diskName: 'USB',
    hasher: testHasher,
    readExif: async () => ({ date: null }),
    device: { id: 'pc', name: 'PC' },
    settings: { ...DEFAULT_SETTINGS, runFolder: true },
    control: new Controller(),
    onProgress: () => {},
    now: () => now,
    openRunFolder: async (n: string) => t.child(n),
    readOnce: true,
    slowSource: true,
    sourceName: () => 'Móvil',
    mirror: { stripFirst: true },
    hashCache,
  })
  return { t, base }
}

const phone = (n: number) => Array.from({ length: n }, (_, i) => src(`Móvil/DCIM/IMG_${i}.jpg`, `foto número ${i}`.padEnd(20 + i, '.'), MAY))

describe('resumen antes de empezar', () => {
  it('cuenta todo, lo nuevo y lo que ocupa; "solo lo nuevo" copia solo eso', async () => {
    const { t, base } = setup()
    // Primera copia: 3 fotos.
    const first = await runBackup({ ...base(new Date(2026, 9, 20, 10, 0)), scan: async () => ({ files: phone(3), ignored: [] }) })

    // Índice de lo ya guardado (como knownOnDisk en la app).
    const manifest = JSON.parse((await t.readText(`${first.folder}/.backup-ignore/.backup-manifest.json`))!) as { entries: Array<{ hash: string; diskPath: string }> }
    const onDisk = new Map(manifest.entries.map((e) => [e.hash, e]))
    const box: { seen?: PreSummary } = {}
    const second = await runBackup({
      ...base(new Date(2026, 9, 21, 10, 0)),
      scan: async () => ({ files: phone(5), ignored: [] }),
      estimateKnown: (h) => onDisk.get(h) as never,
      confirm: async (s) => {
        box.seen = s
        return 'new'
      },
    })
    expect(box.seen!.found).toBe(5)
    expect(box.seen!.all.count).toBe(5)
    expect(box.seen!.fresh.count).toBe(2)
    expect(box.seen!.fresh.bytes).toBeLessThan(box.seen!.all.bytes)
    expect(second.copied.map((c) => c.sourcePath)).toEqual(['Móvil/DCIM/IMG_3.jpg', 'Móvil/DCIM/IMG_4.jpg'])
    expect(second.duplicates).toHaveLength(3)
  })

  it('"Copiar todo" copia todo; "No copiar ahora" no copia nada', async () => {
    const { t, base } = setup()
    const all = await runBackup({ ...base(new Date(2026, 9, 20, 10, 0)), scan: async () => ({ files: phone(3), ignored: [] }), confirm: async () => 'all' })
    expect(all.copied).toHaveLength(3)
    const none = await runBackup({ ...base(new Date(2026, 9, 20, 11, 0)), scan: async () => ({ files: phone(3), ignored: [] }), confirm: async () => 'cancel' })
    expect(none.outcome).toBe('cancelled')
    expect(none.previewCancelled).toBe(true)
    expect(none.copied).toHaveLength(0)
    expect(t.mediaPaths().filter((p) => p.startsWith(none.folder!))).toEqual([])
  })
})