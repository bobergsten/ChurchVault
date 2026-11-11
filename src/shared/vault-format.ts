/**
 * On-disk formats stored in the Git repository. Everything here is safe to
 * publish: secrets only appear encrypted.
 */

export const FORMAT_VERSION = 1

export interface KdfParams {
  alg: 'argon2id13'
  opslimit: number
  memlimit: number
  /** base64 */
  salt: string
}

export interface SealedBytes {
  /** base64 */
  nonce: string
  /** base64 */
  ct: string
}

/** vault.json */
export interface VaultHeader {
  format: number
  vaultId: string
  createdAt: string
  /** Increases by one every time the vault key is rotated. */
  generation: number
  /** The vault key encrypted with the recovery key. */
  recovery: SealedBytes
}

/** members/<id>.json */
export interface MemberFile {
  format: number
  id: string
  name: string
  createdAt: string
  /** X25519 public key, base64 */
  publicKey: string
  /** X25519 secret key encrypted with a key derived from the member's password. */
  wrappedSecretKey: SealedBytes & { kdf: KdfParams }
  /** The vault key sealed to `publicKey`. Absent until an existing member grants access. */
  sealedVaultKey?: { generation: number; ct: string }
}

/** entries/<id>.vault */
export interface EntryEnvelope {
  format: number
  generation: number
  nonce: string
  ct: string
}
