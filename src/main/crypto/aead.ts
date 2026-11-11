import type { SealedBytes } from '@shared/vault-format'
import { getSodium } from './sodium'

/**
 * Authenticated encryption (XChaCha20-Poly1305). `aad` is authenticated but not
 * stored: it binds a ciphertext to its context (e.g. the entry id), so files
 * cannot be swapped or renamed without detection.
 */
export async function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): Promise<SealedBytes> {
  const s = await getSodium()
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  const ct = s.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, key)
  return { nonce: s.to_base64(nonce), ct: s.to_base64(ct) }
}

/** Returns null when the key is wrong or the data/aad was modified. */
export async function open(key: Uint8Array, sealed: SealedBytes, aad: string): Promise<Uint8Array | null> {
  const s = await getSodium()
  try {
    return s.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      s.from_base64(sealed.ct),
      aad,
      s.from_base64(sealed.nonce),
      key
    )
  } catch {
    return null
  }
}
