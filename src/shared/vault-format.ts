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
  /**
   * One link per key rotation: the previous vault key encrypted with the key of
   * `generation`. Lets a computer that trusted an older key verify a newer one.
   */
  keyChain?: (SealedBytes & { generation: number })[]
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
  /**
   * MAC over vault id, member id, name and public key, keyed from the vault key of
   * `generation`. Written by whoever granted access; someone with only write access
   * to the repo cannot forge it, so a swapped public key is detected.
   */
  attestation?: { generation: number; mac: string }
}

/** entries/<id>.vault */
export interface EntryEnvelope {
  format: number
  generation: number
  nonce: string
  ct: string
}
