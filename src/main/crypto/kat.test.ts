/**
 * Known-answer tests: published test vectors, so a broken or swapped crypto build
 * cannot pass by merely round-tripping its own output.
 */
import { describe, expect, it } from 'vitest'
import { getSodium } from './sodium'

const hex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s.replace(/\s+/g, ''), 'hex'))
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

describe('known-answer tests', () => {
  it('X25519 (RFC 7748 section 6.1)', async () => {
    const s = await getSodium()
    const alicePriv = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a')
    const bobPriv = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb')
    expect(toHex(s.crypto_scalarmult_base(alicePriv))).toBe('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a')
    expect(toHex(s.crypto_scalarmult_base(bobPriv))).toBe('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f')
    const shared = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742'
    expect(toHex(s.crypto_scalarmult(alicePriv, s.crypto_scalarmult_base(bobPriv)))).toBe(shared)
    expect(toHex(s.crypto_scalarmult(bobPriv, s.crypto_scalarmult_base(alicePriv)))).toBe(shared)
  })

  it('XChaCha20-Poly1305 (draft-irtf-cfrg-xchacha-03 A.3.1)', async () => {
    const s = await getSodium()
    const plaintext = new TextEncoder().encode(
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it."
    )
    const aad = hex('50515253c0c1c2c3c4c5c6c7')
    const key = hex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f')
    const nonce = hex('404142434445464748494a4b4c4d4e4f5051525354555657')
    const expected =
      'bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb' +
      '731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b452' +
      '2f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff9' +
      '21f9664c97637da9768812f615c68b13b52e' +
      'c0875924c1c7987947deafd8780acf49'
    const ct = s.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, key)
    expect(toHex(ct)).toBe(expected)
    expect(s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, aad, nonce, key)).toEqual(plaintext)
  })

  it('BLAKE2b-512 of "abc" (RFC 7693 appendix A)', async () => {
    const s = await getSodium()
    expect(toHex(s.crypto_generichash(64, new TextEncoder().encode('abc'), null))).toBe(
      'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1' +
        '7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923'
    )
  })

  it('Argon2id honours its cost parameters (no public vector fits libsodium’s API)', async () => {
    const s = await getSodium()
    const salt = new Uint8Array(16).fill(2)
    const a = s.crypto_pwhash(32, 'pw', salt, 1, 8 * 1024 * 1024, s.crypto_pwhash_ALG_ARGON2ID13)
    const b = s.crypto_pwhash(32, 'pw', salt, 2, 8 * 1024 * 1024, s.crypto_pwhash_ALG_ARGON2ID13)
    const c = s.crypto_pwhash(32, 'pw', salt, 1, 16 * 1024 * 1024, s.crypto_pwhash_ALG_ARGON2ID13)
    // Argon2i (needs >= 3 passes) must differ from Argon2id with identical inputs.
    const id3 = s.crypto_pwhash(32, 'pw', salt, 3, 8 * 1024 * 1024, s.crypto_pwhash_ALG_ARGON2ID13)
    const i3 = s.crypto_pwhash(32, 'pw', salt, 3, 8 * 1024 * 1024, s.crypto_pwhash_ALG_ARGON2I13)
    expect(new Set([a, b, c, id3, i3].map(toHex)).size).toBe(5)
    expect(s.crypto_pwhash_ALG_ARGON2ID13).not.toBe(s.crypto_pwhash_ALG_ARGON2I13)
  })
})
