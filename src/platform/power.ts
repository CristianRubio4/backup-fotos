// Mantener la pantalla encendida (Screen Wake Lock) y estado de la batería.

export type WakeState = 'on' | 'off' | 'unsupported' | 'failed'

let sentinel: WakeLockSentinel | null = null
let wanted = false
let onChange: (s: WakeState) => void = () => {}

async function acquire() {
  if (!('wakeLock' in navigator)) return onChange('unsupported')
  try {
    sentinel = await navigator.wakeLock.request('screen')
    sentinel.addEventListener('release', () => {
      sentinel = null
      if (wanted) onChange('off') // el navegador lo suelta al ocultar la pestaña
    })
    onChange('on')
  } catch {
    onChange('failed')
  }
}

// Al volver a la pestaña (o si se denegó por no tener el foco) hay que pedirlo otra vez.
if (typeof document !== 'undefined') {
  const retry = () => {
    if (wanted && !sentinel && document.visibilityState === 'visible') void acquire()
  }
  document.addEventListener('visibilitychange', retry)
  window.addEventListener('focus', retry)
}

/** Mantiene la pantalla encendida mientras `on` sea true. */
export function keepScreenOn(on: boolean, listener?: (s: WakeState) => void) {
  wanted = on
  if (listener) onChange = listener
  if (on) {
    if (!sentinel) void acquire()
  } else {
    void sentinel?.release()
    sentinel = null
    onChange('off')
  }
}

export interface BatteryInfo {
  level: number // 0-1
  charging: boolean
}

interface BatteryManager extends EventTarget {
  level: number
  charging: boolean
}

let battery: Promise<BatteryManager | null> | null = null

function getBattery() {
  battery ??= (async () => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }
    try {
      return nav.getBattery ? await nav.getBattery() : null
    } catch {
      return null
    }
  })()
  return battery
}

/** Estado de la batería, o null si el navegador no lo da (Safari, Firefox) o no hay batería. */
export async function readBattery(): Promise<BatteryInfo | null> {
  const b = await getBattery()
  return b ? { level: b.level, charging: b.charging } : null
}

/** Avisa de cada cambio de batería. Devuelve la función para dejar de escuchar. */
export async function watchBattery(fn: (b: BatteryInfo) => void) {
  const b = await getBattery()
  if (!b) return () => {}
  const handler = () => fn({ level: b.level, charging: b.charging })
  b.addEventListener('levelchange', handler)
  b.addEventListener('chargingchange', handler)
  return () => {
    b.removeEventListener('levelchange', handler)
    b.removeEventListener('chargingchange', handler)
  }
}

export const BATTERY_WARN = 0.2
export const BATTERY_PAUSE = 0.1
