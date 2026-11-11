import { getSodium, VaultError } from './sodium'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function unbase32(text: string): Uint8Array {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of text) {
    const i = ALPHABET.indexOf(ch)
    if (i < 0) throw new VaultError('bad-recovery-key', 'Recovery key contains invalid characters')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

async function checksum(key: Uint8Array): Promise<Uint8Array> {
  const s = await getSodium()
  return s.crypto_generichash(2, key, null)
}

/** Human-friendly recovery key: 32 random bytes + 2-byte checksum, base32, in groups of 5. */
export async function generateRecoveryKey(): Promise<{ key: Uint8Array; text: string }> {
  const s = await getSodium()
  const key = s.randombytes_buf(32)
  const full = new Uint8Array(34)
  full.set(key)
  full.set(await checksum(key), 32)
  return { key, text: base32(full).match(/.{1,5}/g)!.join('-') }
}

/** Parse what a person typed. Tolerates case, spaces and dashes; detects typos. */
export async function parseRecoveryKey(text: string): Promise<Uint8Array> {
  const cleaned = text.toUpperCase().replace(/[\s-]/g, '')
  const bytes = unbase32(cleaned).slice(0, 34)
  if (bytes.length !== 34) throw new VaultError('bad-recovery-key', 'Recovery key has the wrong length')
  const key = bytes.slice(0, 32)
  const check = await checksum(key)
  if (check[0] !== bytes[32] || check[1] !== bytes[33]) {
    throw new VaultError('bad-recovery-key', 'Recovery key has a typo (checksum mismatch)')
  }
  return key
}
