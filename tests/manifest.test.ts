import { describe, expect, it } from 'vitest'
import {
  JOURNAL_DIR,
  MANIFEST_BAK,
  MANIFEST_FILE,
  MANIFEST_TMP,
  parseManifest,
  type Manifest,
  type ManifestEntry,
} from '../src/core/manifest/schema'
import { ManifestStore, safeWriteManifest } from '../src/core/manifest/store'
import { ManifestCorruptError } from '../src/core/types'
import { MemoryTarget } from './fakes'

const h = (c: string) => c.repeat(64)

function entry(hashChar: string, diskPath = `2024/05/${hashChar}.jpg`): ManifestEntry {
  return {
    hash: h(hashChar),
    size: 10,
    originalName: `${hashChar}.jpg`,
    sourcePath: `${hashChar}.jpg`,
    diskPath,
    exifDate: null,
    fileDate: '2024-05-17T08:30:00.000Z',
    deviceId: 'dev',
    deviceName: 'Portátil',
    status: 'verified',
    copiedAt: '2024-05-18T08:30:00.000Z',
  }
}

function manifest(entries: ManifestEntry[], updatedAt = '2024-05-18T00:00:00.000Z'): Manifest {
  return { version: 1, diskId: 'disk', createdAt: '2024-01-01T00:00:00.000Z', updatedAt, entries }
}

describe('parseManifest', () => {
  it('acepta un manifest válido', () => {
    expect(parseManifest(JSON.stringify(manifest([entry('a')])))?.entries).toHaveLength(1)
  })

  it.each([
    ['null', null],
    ['JSON truncado', '{"version":1,"diskId":"d","entr'],
    ['versión desconocida', JSON.stringify({ ...manifest([]), version: 2 })],
    ['hash no válido', JSON.stringify(manifest([{ ...entry('a'), hash: 'xyz' }]))],
    ['estado no válido', JSON.stringify(manifest([{ ...entry('a'), status: 'ok' as never }]))],
    ['sin entries', JSON.stringify({ ...manifest([]), entries: undefined })],
  ])('rechaza %s', (_, text) => {
    expect(parseManifest(text as string | null)).toBeNull()
  })
})

describe('safeWriteManifest', () => {
  it('guarda la versión anterior en .bak y no deja .tmp', async () => {
    const t = new MemoryTarget()
    await safeWriteManifest(t, manifest([entry('a')]))
    await safeWriteManifest(t, manifest([entry('a'), entry('b')]))
    expect(parseManifest(await t.readText(MANIFEST_FILE))?.entries).toHaveLength(2)
    expect(parseManifest(await t.readText(MANIFEST_BAK))?.entries).toHaveLength(1)
    expect(await t.readText(MANIFEST_TMP)).toBeNull()
  })

  it('no sobrescribe un .bak bueno con un principal dañado', async () => {
    const t = new MemoryTarget()
    await t.writeText(MANIFEST_BAK, JSON.stringify(manifest([entry('a')])))
    await t.writeText(MANIFEST_FILE, '{roto')
    await safeWriteManifest(t, manifest([entry('a'), entry('b')]))
    expect(parseManifest(await t.readText(MANIFEST_BAK))?.entries).toHaveLength(1)
  })
})

describe('ManifestStore.open', () => {
  it('disco nuevo: manifest vacío', async () => {
    const { store, recovery } = await ManifestStore.open(new MemoryTarget(), 'disk')
    expect(store.size).toBe(0)
    expect(recovery.source).toBe('new')
  })

  it('principal dañado: recupera desde .bak', async () => {
    const t = new MemoryTarget()
    await t.writeText(MANIFEST_FILE, '{"version":1,"entries":[{"ha')
    await t.writeText(MANIFEST_BAK, JSON.stringify(manifest([entry('a')])))
    const { store, recovery } = await ManifestStore.open(t, 'disk')
    expect(recovery.source).toBe('bak')
    expect(store.findByHash(h('a'))).toBeDefined()
  })

  it('usa .tmp si es más reciente que el principal (corte entre las dos escrituras)', async () => {
    const t = new MemoryTarget()
    await t.writeText(MANIFEST_FILE, JSON.stringify(manifest([entry('a')], '2024-05-18T00:00:00.000Z')))
    await t.writeText(MANIFEST_TMP, JSON.stringify(manifest([entry('a'), entry('b')], '2024-05-19T00:00:00.000Z')))
    const { store, recovery } = await ManifestStore.open(t, 'disk')
    expect(recovery.source).toBe('tmp')
    expect(store.size).toBe(2)
  })

  it('todo dañado: lanza ManifestCorruptError (nunca empieza de cero en silencio)', async () => {
    const t = new MemoryTarget()
    await t.writeText(MANIFEST_FILE, 'basura')
    await t.writeText(MANIFEST_BAK, '')
    await expect(ManifestStore.open(t, 'disk')).rejects.toBeInstanceOf(ManifestCorruptError)
  })

  it('aplica el diario de un backup interrumpido y lo elimina al compactar', async () => {
    const t = new MemoryTarget()
    await safeWriteManifest(t, manifest([entry('a')]))
    const first = (await ManifestStore.open(t, 'disk')).store
    first.add(entry('b'))
    await first.flushJournal()
    first.add(entry('c'))
    await first.flushJournal()
    await t.writeText(`${JOURNAL_DIR}/000099.json`, '{roto')

    const { store, recovery } = await ManifestStore.open(t, 'disk')
    expect(store.size).toBe(3)
    expect(recovery.journalApplied).toBe(2)
    expect(recovery.journalCorrupt).toBe(1)

    await store.compact()
    expect(await t.list(JOURNAL_DIR)).toEqual([])
    expect(parseManifest(await t.readText(MANIFEST_FILE))?.entries).toHaveLength(3)
  })

  it('compara rutas del disco sin distinguir mayúsculas', async () => {
    const t = new MemoryTarget()
    await safeWriteManifest(t, manifest([entry('a', '2024/05/IMG.JPG')]))
    const { store } = await ManifestStore.open(t, 'disk')
    expect(store.hasDiskPath('2024/05/img.jpg')).toBe(true)
  })
})
