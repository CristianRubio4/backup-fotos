import { describe, expect, it } from 'vitest'
import { runBackup } from '../src/core/backup/engine'
import { Controller, noControl } from '../src/core/control'
import { MANIFEST_BAK, MANIFEST_FILE, parseManifest } from '../src/core/manifest/schema'
import { ManifestStore } from '../src/core/manifest/store'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import { checkIntegrity, diskRepairSource, rebuildManifest, repairEntries, sourcesRepairSource } from '../src/core/tools/integrity'
import type { SourceFile } from '../src/core/types'
import { MemoryTarget, src, testHasher } from './fakes'

const MAY = new Date(2024, 4, 17, 10, 30, 0).getTime()
const files = () => [src('a.jpg', 'foto A', MAY), src('b.jpg', 'foto BB', MAY), src('c.mp4', 'vídeo CCC', MAY)]

async function backup(t: MemoryTarget, f: SourceFile[] = files()) {
  const r = await runBackup({
    target: t,
    diskName: 'USB',
    scan: async () => ({ files: f, ignored: [] }),
    hasher: testHasher,
    readExif: async () => ({ date: null }),
    device: { id: 'd', name: 'P' },
    settings: DEFAULT_SETTINGS,
    control: new Controller(),
    onProgress: () => {},
  })
  return r.diskId!
}

const open = (t: MemoryTarget, id: string) => ManifestStore.open(t, id).then((o) => o.store)

describe('comprobar disco', () => {
  it('detecta archivos desaparecidos y dañados', async () => {
    const t = new MemoryTarget()
    const id = await backup(t)
    const [pa, pb] = t.mediaPaths()
    t.files.delete(pa)
    t.files.get(pb)![0] ^= 0xff // un byte cambiado
    const r = await checkIntegrity({ target: t, store: await open(t, id), control: noControl })
    expect(r.checked).toBe(3)
    expect(r.ok).toBe(1)
    expect(r.missing.map((e) => e.diskPath)).toEqual([pa])
    expect(r.damaged.map((e) => e.diskPath)).toEqual([pb])
  })

  it('vuelve a copiarlos desde el origen y los verifica', async () => {
    const t = new MemoryTarget()
    const id = await backup(t)
    const [pa, pb] = t.mediaPaths()
    t.files.delete(pa)
    t.files.get(pb)![0] ^= 0xff
    const store = await open(t, id)
    const check = await checkIntegrity({ target: t, store, control: noControl })
    const r = await repairEntries({
      target: t,
      store,
      entries: [...check.missing, ...check.damaged],
      sources: [sourcesRepairSource(files(), testHasher, undefined, noControl)],
      control: noControl,
    })
    expect(r.repaired).toHaveLength(2)
    const again = await checkIntegrity({ target: t, store: await open(t, id), control: noControl })
    expect(again.ok).toBe(3)
  })

  it('o desde otro disco registrado', async () => {
    const t1 = new MemoryTarget()
    const t2 = new MemoryTarget()
    const id1 = await backup(t1)
    const id2 = await backup(t2)
    const [pa] = t1.mediaPaths()
    t1.files.delete(pa)
    const store = await open(t1, id1)
    const check = await checkIntegrity({ target: t1, store, control: noControl })
    const r = await repairEntries({ target: t1, store, entries: check.missing, sources: [await diskRepairSource('Disco 2', t2, id2, noControl)], control: noControl })
    expect(r.repaired[0].from).toBe('Disco 2')
    expect(t1.mediaPaths()).toContain(pa)
  })

  it('informa de lo que no se encuentra en ningún sitio', async () => {
    const t = new MemoryTarget()
    const id = await backup(t)
    t.files.delete(t.mediaPaths()[0])
    const store = await open(t, id)
    const check = await checkIntegrity({ target: t, store, control: noControl })
    const r = await repairEntries({ target: t, store, entries: check.missing, sources: [sourcesRepairSource([], testHasher, undefined, noControl)], control: noControl })
    expect(r.notFound).toHaveLength(1)
  })
})

describe('reconstruir manifest', () => {
  it('con el manifest y la copia dañados, registra todo lo que hay en el disco', async () => {
    const t = new MemoryTarget()
    const id = await backup(t)
    await t.writeText(MANIFEST_FILE, '{dañado')
    await t.writeText(MANIFEST_BAK, '{dañado también')
    await expect(ManifestStore.open(t, id)).rejects.toThrow()

    const r = await rebuildManifest({ target: t, diskId: id, control: noControl })
    expect(r.added).toBe(3)
    const m = parseManifest(await t.readText(MANIFEST_FILE))!
    expect(m.entries.map((e) => e.originalName).sort()).toEqual(['a.jpg', 'b.jpg', 'c.mp4'])
    expect([...t.files.keys()].some((k) => k.startsWith('.backup-manifest.danado-'))).toBe(true) // se guarda el dañado

    // Tras reconstruir, un nuevo backup no duplica nada
    const before = t.mediaPaths().length
    await backup(t)
    expect(t.mediaPaths()).toHaveLength(before)
  })
})
