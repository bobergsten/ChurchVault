import {
  FORMAT_VERSION,
  type EntryEnvelope,
  type KdfParams,
  type MemberFile,
  type VaultHeader
} from '@shared/vault-format'
import { open, seal } from './aead'
import { defaultKdfParams, deriveKeyFromPassword } from './kdf'
import { generateRecoveryKey, parseRecoveryKey } from './recovery'
import { getSodium, VaultError } from './sodium'

const enc = new TextEncoder()
const dec = new TextDecoder()

const aadRecovery = (vaultId: string, generation: number): string =>
  `churchvault/recovery/v1/${vaultId}/${generation}`
const aadSecretKey = (memberId: string): string => `churchvault/member-key/v1/${memberId}`
const aadEntry = (vaultId: string, id: string, generation: number): string =>
  `churchvault/entry/v1/${vaultId}/${id}/${generation}`

/**
 * An unlocked vault. Holds the vault key in memory; call `close()` (auto-lock,
 * quit) to wipe it. Never persist or log it.
 */
export class VaultSession {
  private key: Uint8Array | null

  constructor(
    key: Uint8Array,
    readonly vaultId: string,
    readonly generation: number
  ) {
    this.key = key
  }

  get isOpen(): boolean {
    return this.key !== null
  }

  /** @internal */
  get vaultKey(): Uint8Array {
    if (!this.key) throw new Error('Vault is locked')
    return this.key
  }

  /** 32-byte key for the local SQLCipher index, derived so the vault key itself is never used for it. */
  async sqliteKey(): Promise<Uint8Array> {
    const s = await getSodium()
    return s.crypto_kdf_derive_from_key(32, 1, 'sqlitedb', this.vaultKey)
  }

  /** Separate key for attachments, so entries and blobs never share a key. */
  async blobKey(): Promise<Uint8Array> {
    const s = await getSodium()
    return s.crypto_kdf_derive_from_key(32, 2, 'blobdata', this.vaultKey)
  }

  close(): void {
    this.key?.fill(0)
    this.key = null
  }
}

export interface CreatedVault {
  header: VaultHeader
  member: MemberFile
  session: VaultSession
  /** Show once and ask the admin to print it. Not stored anywhere. */
  recoveryKey: string
}

function newId(s: Awaited<ReturnType<typeof getSodium>>): string {
  return s.to_hex(s.randombytes_buf(16))
}

/** Short fingerprint of a public key, for members to compare out of band when adding someone. */
export async function fingerprint(publicKeyB64: string): Promise<string> {
  const s = await getSodium()
  const h = s.to_hex(s.crypto_generichash(10, s.from_base64(publicKeyB64), null)).toUpperCase()
  return h.match(/.{1,4}/g)!.join(' ')
}

/** First launch for a new person: create their identity. They then send `publicKey` to an existing member. */
export async function createMemberIdentity(opts: {
  name: string
  password: string
  kdf?: KdfParams
  /** Keep an existing member id (password reset); a new one is generated otherwise. */
  id?: string
}): Promise<MemberFile> {
  const s = await getSodium()
  const kdf = opts.kdf ?? (await defaultKdfParams())
  const id = opts.id ?? newId(s)
  const pair = s.crypto_box_keypair()
  const wrapKey = await deriveKeyFromPassword(opts.password, kdf)
  const wrapped = await seal(wrapKey, pair.privateKey, aadSecretKey(id))
  wrapKey.fill(0)
  pair.privateKey.fill(0)
  return {
    format: FORMAT_VERSION,
    id,
    name: opts.name,
    createdAt: new Date().toISOString(),
    publicKey: s.to_base64(pair.publicKey),
    wrappedSecretKey: { ...wrapped, kdf }
  }
}

async function sealVaultKeyTo(publicKeyB64: string, vaultKey: Uint8Array): Promise<string> {
  const s = await getSodium()
  return s.to_base64(s.crypto_box_seal(vaultKey, s.from_base64(publicKeyB64)))
}

async function wrapForRecovery(
  vaultKey: Uint8Array,
  recoveryKey: Uint8Array,
  vaultId: string,
  generation: number
) {
  return seal(recoveryKey, vaultKey, aadRecovery(vaultId, generation))
}

/** Create a brand new vault whose first member (an admin) is `adminName`. */
export async function createVault(opts: {
  adminName: string
  password: string
  kdf?: KdfParams
}): Promise<CreatedVault> {
  const s = await getSodium()
  const vaultId = newId(s)
  const vaultKey = s.randombytes_buf(32)
  const recovery = await generateRecoveryKey()
  const header: VaultHeader = {
    format: FORMAT_VERSION,
    vaultId,
    createdAt: new Date().toISOString(),
    generation: 1,
    recovery: await wrapForRecovery(vaultKey, recovery.key, vaultId, 1)
  }
  recovery.key.fill(0)
  const member = await createMemberIdentity({ name: opts.adminName, password: opts.password, kdf: opts.kdf })
  member.sealedVaultKey = { generation: 1, ct: await sealVaultKeyTo(member.publicKey, vaultKey) }
  return { header, member, session: new VaultSession(vaultKey, vaultId, 1), recoveryKey: recovery.text }
}

async function openSecretKey(member: MemberFile, password: string): Promise<Uint8Array> {
  const wrapKey = await deriveKeyFromPassword(password, member.wrappedSecretKey.kdf)
  try {
    const sk = await open(wrapKey, member.wrappedSecretKey, aadSecretKey(member.id))
    if (!sk) throw new VaultError('wrong-password', 'Wrong password')
    return sk
  } finally {
    wrapKey.fill(0)
  }
}

function checkFormat(format: number): void {
  if (format !== FORMAT_VERSION) throw new VaultError('unsupported-format', `Unsupported format ${format}`)
}

/** Unlock with a member's password. */
export async function unlockWithPassword(
  header: VaultHeader,
  member: MemberFile,
  password: string
): Promise<VaultSession> {
  checkFormat(header.format)
  checkFormat(member.format)
  if (!member.sealedVaultKey) {
    throw new VaultError('pending-member', 'An existing member must grant you access first')
  }
  const s = await getSodium()
  const secretKey = await openSecretKey(member, password)
  try {
    const vaultKey = s.crypto_box_seal_open(
      s.from_base64(member.sealedVaultKey.ct),
      s.from_base64(member.publicKey),
      secretKey
    )
    return new VaultSession(vaultKey, header.vaultId, member.sealedVaultKey.generation)
  } catch {
    throw new VaultError('tampered', 'Vault key could not be opened')
  } finally {
    secretKey.fill(0)
  }
}

/** Unlock with the printed recovery key (when a member forgot their password). */
export async function unlockWithRecoveryKey(header: VaultHeader, recoveryKeyText: string): Promise<VaultSession> {
  checkFormat(header.format)
  const key = await parseRecoveryKey(recoveryKeyText)
  const vaultKey = await open(key, header.recovery, aadRecovery(header.vaultId, header.generation))
  key.fill(0)
  if (!vaultKey) throw new VaultError('wrong-recovery-key', 'Recovery key does not match this vault')
  return new VaultSession(vaultKey, header.vaultId, header.generation)
}

/**
 * An unlocked member gives a pending member (who has created an identity) access.
 * Callers should first have both people compare `fingerprint(publicKey)`.
 */
export async function grantAccess(session: VaultSession, pending: MemberFile): Promise<MemberFile> {
  return {
    ...pending,
    sealedVaultKey: {
      generation: session.generation,
      ct: await sealVaultKeyTo(pending.publicKey, session.vaultKey)
    }
  }
}

/**
 * Forgotten password: with the vault open (e.g. through the recovery key), give an
 * existing member a fresh keypair and a new password. Their id and name stay.
 */
export async function resetMember(
  session: VaultSession,
  member: MemberFile,
  newPassword: string,
  kdf?: KdfParams
): Promise<MemberFile> {
  const fresh = await createMemberIdentity({ name: member.name, password: newPassword, kdf, id: member.id })
  return grantAccess(session, { ...fresh, createdAt: member.createdAt })
}

/** Re-wraps the member's secret key. Entries are untouched. */
export async function changePassword(
  member: MemberFile,
  oldPassword: string,
  newPassword: string,
  kdf?: KdfParams
): Promise<MemberFile> {
  const secretKey = await openSecretKey(member, oldPassword)
  const params = kdf ?? (await defaultKdfParams())
  const wrapKey = await deriveKeyFromPassword(newPassword, params)
  const wrapped = await seal(wrapKey, secretKey, aadSecretKey(member.id))
  wrapKey.fill(0)
  secretKey.fill(0)
  return { ...member, wrappedSecretKey: { ...wrapped, kdf: params } }
}

export interface Rotation {
  session: VaultSession
  header: VaultHeader
  /** Updated member files. Pending members (no access yet) are returned unchanged. */
  members: MemberFile[]
  /** New printed recovery key; the old one stops working. */
  recoveryKey: string
}

/**
 * Generate a new vault key, e.g. after removing a member. The caller must then
 * re-encrypt every entry with `rekeyEntry` and commit everything together.
 * Removed members are simply left out of `remainingMembers`.
 */
export async function rotateVaultKey(
  session: VaultSession,
  header: VaultHeader,
  remainingMembers: MemberFile[]
): Promise<Rotation> {
  // Rotation needs proof of access to the current key.
  if (!session.isOpen || session.generation !== header.generation) {
    throw new VaultError('stale-generation', 'Session does not match the current vault key')
  }
  const s = await getSodium()
  const generation = header.generation + 1
  const vaultKey = s.randombytes_buf(32)
  const recovery = await generateRecoveryKey()
  const newHeader: VaultHeader = {
    ...header,
    generation,
    recovery: await wrapForRecovery(vaultKey, recovery.key, header.vaultId, generation)
  }
  recovery.key.fill(0)
  const members = await Promise.all(
    remainingMembers.map(async (m) =>
      m.sealedVaultKey
        ? { ...m, sealedVaultKey: { generation, ct: await sealVaultKeyTo(m.publicKey, vaultKey) } }
        : m
    )
  )
  return {
    session: new VaultSession(vaultKey, header.vaultId, generation),
    header: newHeader,
    members,
    recoveryKey: recovery.text
  }
}

/** Encrypt a JSON-serialisable entry. `id` binds the ciphertext to its file name. */
export async function encryptEntry(session: VaultSession, id: string, entry: unknown): Promise<EntryEnvelope> {
  const sealed = await seal(
    session.vaultKey,
    enc.encode(JSON.stringify(entry)),
    aadEntry(session.vaultId, id, session.generation)
  )
  return { format: FORMAT_VERSION, generation: session.generation, ...sealed }
}

export async function decryptEntry<T = unknown>(
  session: VaultSession,
  id: string,
  envelope: EntryEnvelope
): Promise<T> {
  checkFormat(envelope.format)
  if (envelope.generation !== session.generation) {
    throw new VaultError('stale-generation', 'Entry was encrypted with a different vault key generation')
  }
  const plain = await open(session.vaultKey, envelope, aadEntry(session.vaultId, id, envelope.generation))
  if (!plain) throw new VaultError('tampered', 'Entry is corrupted or was modified')
  return JSON.parse(dec.decode(plain)) as T
}

/** Re-encrypt an entry from the old session's key to the new one (used during rotation). */
export async function rekeyEntry(
  oldSession: VaultSession,
  newSession: VaultSession,
  id: string,
  envelope: EntryEnvelope
): Promise<EntryEnvelope> {
  return encryptEntry(newSession, id, await decryptEntry(oldSession, id, envelope))
}
