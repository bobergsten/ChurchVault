import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { BLOB_CHUNK, VaultError, createVault, decryptBlob, encryptBlob, fastKdfParamsForTests, rekeyBlob, rotateVaultKey } from './index'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const vault = async () => createVault({ adminName: 'A', password: 'pw', kdf: await fastKdfParamsForTests() })

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof VaultError ? e.code : 'other'
  }
}

describe('attachment encryption', () => {
  it('round-trips data of awkward sizes', async () => {
    const { session } = await vault()
    for (const n of [0, 1, BLOB_CHUNK - 1, BLOB_CHUNK, BLOB_CHUNK + 1, 3 * BLOB_CHUNK + 7]) {
      const data = new Uint8Array(randomBytes(n))
      const enc = await encryptBlob(session, ID, data)
      expect(await decryptBlob(session, ID, enc)).toEqual(data)
    }
  })

  it('hides the content and uses a fresh header each time', async () => {
    const { session } = await vault()
    const data = new TextEncoder().encode('Top secret church budget '.repeat(100))
    const a = await encryptBlob(session, ID, data)
    const b = await encryptBlob(session, ID, data)
    expect(Buffer.from(a).includes(Buffer.from('secret'))).toBe(false)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('detects tampering, truncation, extension and reordering', async () => {
    const { session } = await vault()
    const data = new Uint8Array(randomBytes(3 * BLOB_CHUNK))
    const enc = await encryptBlob(session, ID, data)

    const flipped = enc.slice()
    flipped[100] ^= 1
    expect(await code(decryptBlob(session, ID, flipped))).toBe('tampered')

    const chunkLen = 4 + BLOB_CHUNK + 17
    const truncated = enc.slice(0, enc.length - (4 + 17)) // drop the final chunk
    expect(await code(decryptBlob(session, ID, truncated))).toBe('tampered')
    expect(await code(decryptBlob(session, ID, enc.slice(0, enc.length - 1)))).toBe('tampered')

    const extended = new Uint8Array([...enc, 0, 0, 0, 0])
    expect(await code(decryptBlob(session, ID, extended))).toBe('tampered')

    const start = 8 + 24
    const swapped = enc.slice()
    swapped.set(enc.subarray(start + chunkLen, start + 2 * chunkLen), start)
    swapped.set(enc.subarray(start, start + chunkLen), start + chunkLen)
    expect(await code(decryptBlob(session, ID, swapped))).toBe('tampered')

    expect(await code(decryptBlob(session, ID, new Uint8Array(10)))).toBe('tampered')
  })

  it('binds the ciphertext to the blob id and the vault', async () => {
    const a = await vault()
    const b = await vault()
    const enc = await encryptBlob(a.session, ID, new Uint8Array([1, 2, 3]))
    expect(await code(decryptBlob(a.session, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', enc))).toBe('tampered')
    expect(await code(decryptBlob(b.session, ID, enc))).toBe('tampered')
  })

  it('re-encrypts for a new key generation', async () => {
    const { session, header, member } = await vault()
    const enc = await encryptBlob(session, ID, new Uint8Array([9, 8, 7]))
    const rot = await rotateVaultKey(session, header, [member])
    expect(await code(decryptBlob(rot.session, ID, enc))).toBe('stale-generation')
    const re = await rekeyBlob(session, rot.session, ID, enc)
    expect(await decryptBlob(rot.session, ID, re)).toEqual(new Uint8Array([9, 8, 7]))
  })
})
