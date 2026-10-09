// Traduce los errores del navegador (DOMException, casi siempre en inglés)
// a mensajes que el usuario pueda entender y sobre los que pueda actuar.

const MESSAGES: Record<string, string> = {
  NotFoundError: 'No se encuentra el archivo o la carpeta (puede que el dispositivo se haya desconectado, o que el archivo se haya movido o borrado mientras se leía)',
  NotReadableError: 'No se puede leer el archivo (puede estar en uso, bloqueado por el sistema o en un dispositivo desconectado)',
  NotAllowedError: 'El navegador no tiene permiso para acceder a esta carpeta',
  SecurityError: 'El navegador ha bloqueado el acceso a esta carpeta por seguridad',
  NoModificationAllowedError: 'No se puede escribir aquí (el disco o la carpeta es de solo lectura)',
  InvalidStateError: 'El archivo ha cambiado mientras se leía',
  TypeMismatchError: 'Se esperaba un archivo y es una carpeta (o al revés)',
  QuotaExceededError: 'No queda espacio',
  AbortError: 'Operación cancelada',
  EncodingError: 'El archivo no tiene un formato válido',
}

/** Mensaje en español para cualquier error. */
export function friendlyError(err: unknown): string {
  if (err instanceof Error || (typeof err === 'object' && err !== null && 'name' in err)) {
    const e = err as Error
    const known = MESSAGES[e.name]
    if (known) return known
    return e.message || e.name || 'Error desconocido'
  }
  return String(err)
}

/** ¿Es un error de "ya no está" (dispositivo desconectado, archivo borrado)? */
export function isGone(err: unknown) {
  const name = (err as Error)?.name
  return name === 'NotFoundError' || name === 'NotReadableError'
}
