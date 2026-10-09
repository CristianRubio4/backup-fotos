import { describe, expect, it } from 'vitest'
import type { BackupReport, ReportItem } from '../src/core/backup/engine'
import { mergeForced } from '../src/core/backup/report'

const it_ = (p: string): ReportItem => ({ name: p, sourcePath: p, size: 10 })

function report(over: Partial<BackupReport>): BackupReport {
  return {
    outcome: 'completed', startedAt: '', finishedAt: '', diskId: 'd', scanned: 0, ignored: { count: 0, sample: [] },
    copied: [], alreadyOnDisk: [], duplicates: [], discarded: [], unverified: [], reduced: [], errors: [], fat32: [],
    livePhotos: 0, motionPhotos: 0, incorporated: 0, bytesCopied: 0, manifest: null, ...over,
  }
}

describe('mergeForced', () => {
  it('saca de descartados lo copiado y suma al resto', () => {
    const prev = report({ copied: [it_('a')], discarded: [it_('negra.jpg'), it_('rota.jpg')], bytesCopied: 10 })
    const forced = report({ copied: [it_('negra.jpg')], unverified: [it_('negra.jpg')], bytesCopied: 10 })
    const m = mergeForced(prev, forced)
    expect(m.discarded.map((d) => d.sourcePath)).toEqual(['rota.jpg'])
    expect(m.copied.map((d) => d.sourcePath)).toEqual(['a', 'negra.jpg'])
    expect(m.unverified).toHaveLength(1)
    expect(m.bytesCopied).toBe(20)
  })

  it('si el forzado falla, sigue en descartados y aparece el error', () => {
    const prev = report({ discarded: [it_('x.jpg')] })
    const m = mergeForced(prev, report({ errors: [{ ...it_('x.jpg'), reason: 'disco' }] }))
    expect(m.discarded).toHaveLength(1)
    expect(m.errors).toHaveLength(1)
  })
})
