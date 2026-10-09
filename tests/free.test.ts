import { describe, expect, it } from 'vitest'
import { runBackup } from '../src/core/backup/engine'
import { Controller, noControl } from '../src/core/control'
import { ManifestStore } from '../src/core/manifest/store'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import { findFreeable, freeFiles } from '../src/core/tools/free'
import type { SourceFile } from '../src/core/types'
import { MemoryTarget, src, testHasher } from './fakes'

const MAY = new Date(2024, 4, 17, 10, 30, 0).getTime()

async function backup(t: MemoryTarget, files: SourceFile[], verifyHash = true) {
  const r = await runBackup({
    target: t,
    diskName: 'USB',
    scan: async () => ({ files, ignored: [] }),
    hasher: testHasher,
    readExif: async () => ({ date: null }),
    device: { id: 'd', name: 'P' },
    settings: { ...DEFAULT_SETTINGS, verifyHash },
    control: new Controller(),
    onProgress: () => {},
  })
  return (await ManifestStore.open(t, r.diskId!)).store
}

describe('liberar espacio', () => {
  it('solo ofrece lo verificado, nunca lo no verificado ni lo que no está en el backup', async () => {
    const t = new MemoryTarget()
    const a = src('a.jpg', 'foto A', MAY)
    const b = src('b.jpg', 'foto BB', MAY)
    const store = await backup(t, [a])
    store.add({ ...store.entries()[0], hash: 'f'.repeat(64), size: 7, diskPath: 'x/b.jpg', status: 'unverified' }) // simula b no verificado con su hash real abajo
    const nuevo = src('nuevo.jpg', 'sin backup', MAY)
    const scan = await findFreeable({ files: [a, b, nuevo], store, activeDiskName: 'USB', otherDisks: [], hasher: testHasher, control: noControl })
    expect(scan.candidates.map((c) => c.file.relPath)).toEqual(['a.jpg'])
    expect(scan.notBackedUp).toBe(2)
  })

  it('excluye "no verificado" y "posible versión reducida"', async () => {
    const t = new MemoryTarget()
    const a = src('a.jpg', 'foto A', MAY)
    const store = await backup(t, [a], false) // sin verificación por hash → "unverified"
    const scan = await findFreeable({ files: [a], store, activeDiskName: 'USB', otherDisks: [], hasher: testHasher, control: noControl })
    expect(scan.candidates).toHaveLength(0)
    expect(scan.unverified).toHaveLength(1)

    store.annotate(store.entries()[0].hash, { status: 'reduced' })
    const scan2 = await findFreeable({ files: [a], store, activeDiskName: 'USB', otherDisks: [], hasher: testHasher, control: noControl })
    expect(scan2.reduced).toHaveLength(1)
  })

  it('indica en cuántos discos está cada archivo', async () => {
    const t = new MemoryTarget()
    const a = src('a.jpg', 'foto A', MAY)
    const store = await backup(t, [a])
    const hash = store.entries()[0].hash
    const scan = await findFreeable({
      files: [a],
      store,
      activeDiskName: 'Disco 1',
      otherDisks: [{ name: 'Disco 2', statuses: new Map([[hash, 'verified']]) }, { name: 'Disco 3', statuses: new Map([[hash, 'unverified']]) }],
      hasher: testHasher,
      control: noControl,
    })
    expect(scan.candidates[0].disks).toEqual(['Disco 1', 'Disco 2'])
  })

  it('antes de borrar vuelve a verificar la copia del disco y el original', async () => {
    const t = new MemoryTarget()
    const files = [src('a.jpg', 'foto A', MAY), src('b.jpg', 'foto BB', MAY), src('c.jpg', 'foto CCC', MAY)]
    const store = await backup(t, files)
    const scan = await findFreeable({ files, store, activeDiskName: 'USB', otherDisks: [], hasher: testHasher, control: noControl })
    expect(scan.candidates).toHaveLength(3)

    // Se daña la copia de b en el disco y el original de c cambia
    t.files.get(scan.candidates[1].entry.diskPath)![0] ^= 0xff
    const cChanged = { ...scan.candidates[2], file: src('c.jpg', 'foto CCC editada', MAY) }
    const removed: string[] = []
    const r = await freeFiles({
      candidates: [scan.candidates[0], scan.candidates[1], cChanged],
      target: t,
      hasher: testHasher,
      remove: async (c) => void removed.push(c.file.relPath),
      control: noControl,
    })
    expect(removed).toEqual(['a.jpg'])
    expect(r.skipped.map((s) => s.reason)).toEqual(['la copia del disco ya no coincide (¿dañada?)', 'el original ha cambiado desde el backup'])
  })
})
