const forcedCompat = typeof location !== 'undefined' && new URLSearchParams(location.search).has('compatible')

export const capabilities = {
  /** Modo completo: elegir carpetas y escribir en el disco. Con ?compatible se fuerza el modo ZIP. */
  fsAccess: typeof window !== 'undefined' && 'showDirectoryPicker' in window && !forcedCompat,
  webLocks: typeof navigator !== 'undefined' && 'locks' in navigator,
  /** El navegador tendría modo completo, pero el usuario ha elegido el modo compatible. */
  compatForced: forcedCompat,
}

export async function ensurePermission(handle: FileSystemHandle, mode: FsaPermissionMode, request: boolean) {
  const state = await handle.queryPermission({ mode })
  if (state === 'granted' || !request) return state
  return handle.requestPermission({ mode })
}
