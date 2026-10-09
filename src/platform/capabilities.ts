export const capabilities = {
  /** Modo completo: elegir carpetas y escribir en el disco. */
  fsAccess: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
  webLocks: typeof navigator !== 'undefined' && 'locks' in navigator,
}

export async function ensurePermission(handle: FileSystemHandle, mode: FsaPermissionMode, request: boolean) {
  const state = await handle.queryPermission({ mode })
  if (state === 'granted' || !request) return state
  return handle.requestPermission({ mode })
}
