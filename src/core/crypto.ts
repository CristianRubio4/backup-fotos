// Cifrado opcional por disco (Fase 7).

/** Parámetros guardados en .backup-disk-id de un disco cifrado (nunca la contraseña ni la clave). */
export interface EncryptionParams {
  version: 1
  kdf: 'argon2id'
  salt: string
  memoryKiB: number
  iterations: number
  parallelism: number
  /** Texto conocido cifrado con la clave, para comprobar la contraseña. */
  check: string
}

export interface DiskKeys {
  /** Clave AES-GCM de 256 bits derivada de la contraseña. */
  key: CryptoKey
}
