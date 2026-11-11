import { getSodium, VaultError } from './sodium'
import type { VaultSession } from './vault'

/**
 * Encrypted attachment format (blobs/<id>.bin):
 *
 *   "CVB1" | generation (u32 BE) | secretstream header (24 bytes) | chunks...
 *   chunk = length (u32 BE) | XChaCha20-Poly1305 secretstream ciphertext
 *
 * Every chunk is authenticated with the vault id, blob id and key generation, and
 * the last one carries TAG_FINAL, so truncation, reordering, swapping files or
 * replaying a blob from another vault are all detected.
 */
const MAGIC = new TextEncoder().encode('CVB1')
export const BLOB_CHUNK = 64 * 1024

const aad = (vaultId: string, blobId: string, generation: number): string =>
  `churchvault/blob/v1/${vaultId}/${blobId}/${generation}`

export async function encryptBlob(session: VaultSession, blobId: string, data: Uint8Array): Promise<Uint8Array> {
  const s = await getSodium()
  const key = await session.blobKey()
  const { state, header } = s.crypto_secretstream_xchacha20poly1305_init_push(key)
  key.fill(0)
  const ad = aad(session.vaultId, blobId, session.generation)
  const parts: Uint8Array[] = []
  const prefix = new Uint8Array(8)
  prefix.set(MAGIC)
  new DataView(prefix.buffer).setUint32(4, session.generation)
  parts.push(prefix, header)
  let offset = 0
  do {
    const end = Math.min(offset + BLOB_CHUNK, data.length)
    const last = end === data.length
    const ct = s.crypto_secretstream_xchacha20poly1305_push(
      state,
      data.subarray(offset, end),
      ad,
      last ? s.crypto_secretstream_xchacha20poly1305_TAG_FINAL : s.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE
    )
    const len = new Uint8Array(4)
    new DataView(len.buffer).setUint32(0, ct.length)
    parts.push(len, ct)
    offset = end
  } while (offset < data.length)
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export async function decryptBlob(session: VaultSession, blobId: string, bytes: Uint8Array): Promise<Uint8Array> {
  const s = await getSodium()
  const tampered = (): VaultError => new VaultError('tampered', 'Attachment is corrupted or was modified')
  const HEADER = s.crypto_secretstream_xchacha20poly1305_HEADERBYTES
  if (bytes.length < 8 + HEADER || !MAGIC.every((b, i) => bytes[i] === b)) throw tampered()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const generation = view.getUint32(4)
  if (generation !== session.generation) {
    throw new VaultError('stale-generation', 'Attachment was encrypted with a different vault key generation')
  }
  const key = await session.blobKey()
  const state = s.crypto_secretstream_xchacha20poly1305_init_pull(bytes.subarray(8, 8 + HEADER), key)
  key.fill(0)
  const ad = aad(session.vaultId, blobId, generation)
  const parts: Uint8Array[] = []
  let offset = 8 + HEADER
  let final = false
  while (offset < bytes.length) {
    if (final || offset + 4 > bytes.length) throw tampered() // data after the final chunk, or a cut length
    const len = view.getUint32(offset)
    offset += 4
    if (len < s.crypto_secretstream_xchacha20poly1305_ABYTES || offset + len > bytes.length) throw tampered()
    const r = s.crypto_secretstream_xchacha20poly1305_pull(state, bytes.subarray(offset, offset + len), ad)
    if (!r) throw tampered()
    parts.push(r.message)
    final = r.tag === s.crypto_secretstream_xchacha20poly1305_TAG_FINAL
    offset += len
  }
  if (!final) throw tampered() // truncated
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Re-encrypt under a new session (key rotation). */
export async function rekeyBlob(oldSession: VaultSession, newSession: VaultSession, blobId: string, bytes: Uint8Array): Promise<Uint8Array> {
  const plain = await decryptBlob(oldSession, blobId, bytes)
  try {
    return await encryptBlob(newSession, blobId, plain)
  } finally {
    plain.fill(0)
  }
}
