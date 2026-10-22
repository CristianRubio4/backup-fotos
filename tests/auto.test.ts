import { describe, expect, it } from 'vitest'
import { AUTO_COOLDOWN_MS, AutoTrigger } from '../src/core/auto'

describe('copia automática al conectar el móvil', () => {
  it('abrir la app con el móvil ya enchufado no lanza nada; enchufarlo después, sí', () => {
    const a = new AutoTrigger()
    expect(a.check(['movil'], ['movil'], 0)).toEqual([])
    expect(a.check([], ['movil'], 1000)).toEqual([])
    expect(a.check(['movil'], ['movil'], 2000)).toEqual(['movil'])
  })

  it('solo los móviles elegidos como origen', () => {
    const a = new AutoTrigger()
    a.check([], ['movil'], 0)
    expect(a.check(['otro', 'movil'], ['movil'], 1000)).toEqual(['movil'])
  })

  it('un cable flojo (desconecta y conecta) no lanza otra copia hasta pasado un rato', () => {
    const a = new AutoTrigger()
    a.check([], ['m'], 0)
    expect(a.check(['m'], ['m'], 1000)).toEqual(['m'])
    a.ran(['m'], 1000)
    a.check([], ['m'], 2000)
    expect(a.check(['m'], ['m'], 3000)).toEqual([])
    a.check([], ['m'], 4000)
    expect(a.check(['m'], ['m'], 1000 + AUTO_COOLDOWN_MS)).toEqual(['m'])
  })
})