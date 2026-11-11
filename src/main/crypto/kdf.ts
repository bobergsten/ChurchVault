import type { KdfParams } from '@shared/vault-format'
import { getSodium, VaultError } from './sodium'

const MIB = 1024 * 1024

/** Strong defaults for interactive unlock (~256 MiB, takes about a second). */
export async function defaultKdfParams(): Promise<KdfParams> {
  const s = await getSodium()
  return {
    alg: 'argon2id13',
    opslimit: s.crypto_pwhash_OPSLIMIT_MODERATE,
    memlimit: s.crypto_pwhash_MEMLIMIT_MODERATE,
    salt: s.to_base64(s.randombytes_buf(s.crypto_pwhash_SALTBYTES))
  }
}

/** Cheap parameters, for tests only. */
export async function fastKdfParamsForTests(): Promise<KdfParams> {
  const s = await getSodium()
  return {
    alg: 'argon2id13',
    opslimit: 1,
    memlimit: 8 * MIB,
    salt: s.to_base64(s.randombytes_buf(s.crypto_pwhash_SALTBYTES))
  }
}

/** Reject parameters from a file that are nonsensical or would exhaust memory. */
function validate(p: KdfParams): void {
  if (
    p.alg !== 'argon2id13' ||
    !Number.isInteger(p.opslimit) ||
    !Number.isInteger(p.memlimit) ||
    p.opslimit < 1 ||
    p.opslimit > 20 ||
    p.memlimit < 8 * MIB ||
    p.memlimit > 2048 * MIB
  ) {
    throw new VaultError('invalid-kdf-params', 'Unsupported key derivation parameters')
  }
}

/** Derive a 32-byte key from a password. The password is NFKC-normalised first. */
export async function deriveKeyFromPassword(password: string, p: KdfParams): Promise<Uint8Array> {
  validate(p)
  const s = await getSodium()
  return s.crypto_pwhash(
    32,
    password.normalize('NFKC'),
    s.from_base64(p.salt),
    p.opslimit,
    p.memlimit,
    s.crypto_pwhash_ALG_ARGON2ID13
  )
}
