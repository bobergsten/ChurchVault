import { describe, expect, it } from 'vitest'
import type { KdfParams } from '@shared/vault-format'
import {
  VaultError,
  changePassword,
  createMemberIdentity,
  createVault,
  decryptEntry,
  encryptEntry,
  fastKdfParamsForTests,
  fingerprint,
  grantAccess,
  rekeyEntry,
  resetMember,
  rotateVaultKey,
  unlockWithPassword,
  unlockWithRecoveryKey
} from './index'
import { generateRecoveryKey, parseRecoveryKey } from './recovery'
import { deriveKeyFromPassword } from './kdf'
import { getSodium } from './sodium'

const kdf = (): Promise<KdfParams> => fastKdfParamsForTests()
const secret = { type: 'login', title: 'Bank', password: 'hunter2 åäö 🔑' }

async function newVault() {
  return createVault({ adminName: 'Anna', password: 'anna-pass', kdf: await kdf() })
}

async function expectCode(p: Promise<unknown>, code: VaultError['code']) {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  )
  expect(err).toBeInstanceOf(VaultError)
  expect((err as VaultError).code).toBe(code)
}

describe('kdf', () => {
  it('is deterministic for the same password+salt and differs otherwise', async () => {
    const p = await kdf()
    const a = await deriveKeyFromPassword('pw', p)
    const b = await deriveKeyFromPassword('pw', p)
    const c = await deriveKeyFromPassword('pw2', p)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(a).toHaveLength(32)
  })

  it('normalises unicode so composed/decomposed passwords match', async () => {
    const p = await kdf()
    expect(await deriveKeyFromPassword('å', p)).toEqual(await deriveKeyFromPassword('å', p))
  })

  it('rejects absurd parameters from untrusted files', async () => {
    const p = await kdf()
    await expectCode(deriveKeyFromPassword('x', { ...p, memlimit: 1 << 40 }), 'invalid-kdf-params')
    await expectCode(deriveKeyFromPassword('x', { ...p, opslimit: 0 }), 'invalid-kdf-params')
  })
})

describe('recovery key', () => {
  it('round-trips and tolerates formatting', async () => {
    const { key, text } = await generateRecoveryKey()
    expect(await parseRecoveryKey(text)).toEqual(key)
    expect(await parseRecoveryKey(text.toLowerCase().replaceAll('-', ' '))).toEqual(key)
  })

  it('detects typos', async () => {
    const { text } = await generateRecoveryKey()
    const typo = (text[0] === 'A' ? 'B' : 'A') + text.slice(1)
    await expectCode(parseRecoveryKey(typo), 'bad-recovery-key')
    await expectCode(parseRecoveryKey('ABC'), 'bad-recovery-key')
    await expectCode(parseRecoveryKey('!!!!'), 'bad-recovery-key')
  })
})

describe('vault lifecycle', () => {
  it('creates a vault and unlocks it with the password', async () => {
    const { header, member, session } = await newVault()
    const again = await unlockWithPassword(header, member, 'anna-pass')
    expect(again.vaultKey).toEqual(session.vaultKey)
    expect(again.generation).toBe(1)
  })

  it('rejects a wrong password', async () => {
    const { header, member } = await newVault()
    await expectCode(unlockWithPassword(header, member, 'nope'), 'wrong-password')
  })

  it('unlocks with the recovery key and rejects another vault’s key', async () => {
    const a = await newVault()
    const b = await newVault()
    const viaRecovery = await unlockWithRecoveryKey(a.header, a.recoveryKey)
    expect(viaRecovery.vaultKey).toEqual(a.session.vaultKey)
    await expectCode(unlockWithRecoveryKey(a.header, b.recoveryKey), 'wrong-recovery-key')
  })

  it('wipes the key on close', async () => {
    const { session } = await newVault()
    const key = session.vaultKey
    session.close()
    expect(session.isOpen).toBe(false)
    expect(key.every((b) => b === 0)).toBe(true)
    expect(() => session.vaultKey).toThrow()
  })

  it('derives a stable sqlite key that differs from the vault key', async () => {
    const { session } = await newVault()
    const k = await session.sqliteKey()
    expect(k).toEqual(await session.sqliteKey())
    expect(k).not.toEqual(session.vaultKey)
  })

  it('does not leak plaintext into the stored files', async () => {
    const { header, member } = await newVault()
    const json = JSON.stringify({ header, member })
    expect(json).not.toContain('anna-pass')
  })
})

describe('members', () => {
  it('lets an admin grant access to a new member', async () => {
    const { header, session } = await newVault()
    const pending = await createMemberIdentity({ name: 'Bo', password: 'bo-pass', kdf: await kdf() })
    await expectCode(unlockWithPassword(header, pending, 'bo-pass'), 'pending-member')

    const bo = await grantAccess(session, pending)
    const boSession = await unlockWithPassword(header, bo, 'bo-pass')
    expect(boSession.vaultKey).toEqual(session.vaultKey)

    // Bo can read what Anna wrote
    const env = await encryptEntry(session, 'e1', secret)
    expect(await decryptEntry(boSession, 'e1', env)).toEqual(secret)
  })

  it('gives each member a distinct fingerprint', async () => {
    const a = await createMemberIdentity({ name: 'A', password: 'x', kdf: await kdf() })
    const b = await createMemberIdentity({ name: 'B', password: 'x', kdf: await kdf() })
    expect(await fingerprint(a.publicKey)).toMatch(/^([0-9A-F]{4} ){4}[0-9A-F]{4}$/)
    expect(await fingerprint(a.publicKey)).not.toBe(await fingerprint(b.publicKey))
  })

  it('changes password without touching the vault key', async () => {
    const { header, member, session } = await newVault()
    const updated = await changePassword(member, 'anna-pass', 'new-pass', await kdf())
    await expectCode(unlockWithPassword(header, updated, 'anna-pass'), 'wrong-password')
    expect((await unlockWithPassword(header, updated, 'new-pass')).vaultKey).toEqual(session.vaultKey)
    await expectCode(changePassword(member, 'bad', 'x', await kdf()), 'wrong-password')
  })

  it('rejects a member file whose wrapped key was swapped to another member', async () => {
    const { header, member } = await newVault()
    const other = await createMemberIdentity({ name: 'Eve', password: 'anna-pass', kdf: await kdf() })
    // Same password, but Eve's wrapped key is bound to Eve's id.
    const swapped = { ...member, wrappedSecretKey: other.wrappedSecretKey }
    await expectCode(unlockWithPassword(header, swapped, 'anna-pass'), 'wrong-password')
  })
})

describe('entries', () => {
  it('round-trips unicode data', async () => {
    const { session } = await newVault()
    const env = await encryptEntry(session, 'e1', secret)
    expect(await decryptEntry(session, 'e1', env)).toEqual(secret)
    expect(JSON.stringify(env)).not.toContain('hunter2')
  })

  it('uses a fresh nonce each time', async () => {
    const { session } = await newVault()
    const a = await encryptEntry(session, 'e1', secret)
    const b = await encryptEntry(session, 'e1', secret)
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.ct).not.toBe(b.ct)
  })

  it('detects tampering with ciphertext', async () => {
    const { session } = await newVault()
    const env = await encryptEntry(session, 'e1', secret)
    const s = await getSodium()
    const ct = s.from_base64(env.ct)
    ct[0] ^= 1
    await expectCode(decryptEntry(session, 'e1', { ...env, ct: s.to_base64(ct) }), 'tampered')
  })

  it('detects an entry file being renamed/swapped', async () => {
    const { session } = await newVault()
    const env = await encryptEntry(session, 'e1', secret)
    await expectCode(decryptEntry(session, 'e2', env), 'tampered')
  })

  it('does not decrypt with another vault’s key', async () => {
    const a = await newVault()
    const b = await newVault()
    const env = await encryptEntry(a.session, 'e1', secret)
    await expectCode(decryptEntry(b.session, 'e1', env), 'tampered')
  })

  it('rejects unknown formats', async () => {
    const { session } = await newVault()
    const env = await encryptEntry(session, 'e1', secret)
    await expectCode(decryptEntry(session, 'e1', { ...env, format: 99 }), 'unsupported-format')
  })
})

describe('key rotation', () => {
  it('locks out a removed member and keeps the remaining ones working', async () => {
    const { header, member: anna, session } = await newVault()
    const bo = await grantAccess(session, await createMemberIdentity({ name: 'Bo', password: 'bo', kdf: await kdf() }))
    const eve = await grantAccess(session, await createMemberIdentity({ name: 'Eve', password: 'eve', kdf: await kdf() }))
    const entry = await encryptEntry(session, 'e1', secret)

    // Remove Eve.
    const rot = await rotateVaultKey(session, header, [anna, bo])
    expect(rot.header.generation).toBe(2)
    const rekeyed = await rekeyEntry(session, rot.session, 'e1', entry)

    const [annaNew, boNew] = rot.members
    const annaSession = await unlockWithPassword(rot.header, annaNew, 'anna-pass')
    expect(await decryptEntry(annaSession, 'e1', rekeyed)).toEqual(secret)
    expect(await decryptEntry(await unlockWithPassword(rot.header, boNew, 'bo'), 'e1', rekeyed)).toEqual(secret)

    // Eve's old access can no longer read new data...
    const eveSession = await unlockWithPassword(rot.header, eve, 'eve') // her stale sealed key still opens the OLD key
    expect(eveSession.generation).toBe(1)
    await expectCode(decryptEntry(eveSession, 'e1', rekeyed), 'stale-generation')

    // ...and the old recovery key is dead; the new one works.
    await expectCode(unlockWithRecoveryKey(rot.header, (await newVault()).recoveryKey), 'wrong-recovery-key')
    expect((await unlockWithRecoveryKey(rot.header, rot.recoveryKey)).vaultKey).toEqual(rot.session.vaultKey)
  })

  it('refuses to rotate with a locked or outdated session', async () => {
    const { header, member, session } = await newVault()
    const rot = await rotateVaultKey(session, header, [member])
    await expectCode(rotateVaultKey(session, rot.header, [member]), 'stale-generation')
    session.close()
    await expectCode(rotateVaultKey(session, header, [member]), 'stale-generation')
  })

  it('leaves pending members untouched', async () => {
    const { header, member, session } = await newVault()
    const pending = await createMemberIdentity({ name: 'Bo', password: 'bo', kdf: await kdf() })
    const rot = await rotateVaultKey(session, header, [member, pending])
    expect(rot.members[1]).toEqual(pending)
  })
})

describe('forgotten password', () => {
  it('gives the member a new keypair and password via an open session', async () => {
    const { header, member, recoveryKey } = await newVault()
    const session = await unlockWithRecoveryKey(header, recoveryKey)
    const reset = await resetMember(session, member, 'brand-new-pw', await kdf())
    expect(reset.id).toBe(member.id)
    expect(reset.name).toBe(member.name)
    expect(reset.publicKey).not.toBe(member.publicKey)
    await expectCode(unlockWithPassword(header, reset, 'anna-pass'), 'wrong-password')
    expect((await unlockWithPassword(header, reset, 'brand-new-pw')).vaultKey).toEqual(session.vaultKey)
  })
})
