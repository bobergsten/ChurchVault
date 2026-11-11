import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { HttpClient } from 'isomorphic-git'
import { MAX_ATTACHMENT_BYTES, type AttachmentPreview, type AttachmentRef, type Entry, type EntryInput } from '@shared/entry'
import { parseEntryInput } from '@shared/entry-validate'
import type { EntrySummary, MemberInfo, MemberSummary, SyncStatus, VaultState } from '@shared/api'
import type { KdfParams, MemberFile, VaultHeader } from '@shared/vault-format'
import {
  VaultError,
  changePassword,
  createMemberIdentity,
  createVault,
  decryptBlob,
  decryptEntry,
  encryptBlob,
  rekeyBlob,
  fingerprint,
  grantAccess,
  rekeyEntry,
  resetMember,
  rotateVaultKey,
  unlockWithPassword,
  unlockWithRecoveryKey,
  verifyKeyHistory,
  verifyMember,
  type VaultSession
} from './crypto'
import { mimeFor, previewFor } from './attachments'
import type { SecretStore } from './secret-store'
import { EntryRepository, FileStore, IndexDb } from './storage'
import { GitSync, SyncError } from './sync/git-sync'

/** Thrown for failures whose message can be shown to the user as-is. */
export class UserError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export interface VaultServiceOptions {
  /** Folder holding the Git working tree (vault.json, members/, entries/). */
  repoDir: string
  /** Folder for the local encrypted index. */
  dataDir: string
  /** Override key derivation cost (tests only). */
  kdf?: KdfParams
  /** Lock automatically after this many ms without `touch()`. 0 disables. */
  idleMs?: number
  onLocked?: () => void
  /** Git transport (`isomorphic-git/http/node` in the app). */
  http: HttpClient
  /** Where the GitHub token is kept. */
  secrets: SecretStore
  onSyncStatus?: (s: SyncStatus) => void
  /** Sync on unlock, shortly after changes, and periodically. Off in tests. */
  autoSync?: boolean
  /** Accepted remote addresses (tests only; the default is github.com repositories over https). */
  allowedRemote?: RegExp
}

const TOKEN_KEY = 'github-token'
const GITHUB_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/
const SYNC_DEBOUNCE_MS = 5_000
const SYNC_INTERVAL_MS = 5 * 60_000

interface Unlocked {
  session: VaultSession
  index: IndexDb
  repo: EntryRepository
  me: MemberSummary
  vaultId: string
  /** Attachments added in an editor but not saved yet: encrypted, in memory only. */
  staged: Map<string, { ref: AttachmentRef; bytes: Uint8Array }>
}

const MIN_PASSWORD = 10
/** Free attempts before delays start; then 2, 4, 8 ... seconds, capped. */
const FREE_ATTEMPTS = 3
const MAX_DELAY_MS = 5 * 60_000

/** The vault as used by the app: owns the unlocked session and everything derived from it. */
export class VaultService {
  private readonly files: FileStore
  private readonly git: GitSync
  private open: Unlocked | null = null
  private idleTimer: NodeJS.Timeout | undefined
  private syncTimer: NodeJS.Timeout | undefined
  private syncInterval: NodeJS.Timeout | undefined
  private syncing: Promise<SyncStatus> | null = null
  private lastSyncAt: string | null = null
  private lastError: SyncStatus['lastError'] = null
  private remoteUrl: string | null = null

  constructor(private readonly opts: VaultServiceOptions) {
    this.files = new FileStore(opts.repoDir)
    this.git = new GitSync({
      dir: opts.repoDir,
      http: opts.http,
      getToken: () => opts.secrets.get(TOKEN_KEY),
      // Commit metadata: the member's name and a placeholder address, never a real e-mail.
      author: () => {
        const me = this.open?.me ?? this.pendingMe
        return { name: me?.name ?? 'ChurchVault', email: `${me?.id ?? 'unknown'}@members.churchvault.invalid` }
      }
    })
  }

  private failedAttempts = 0
  private nextAttemptAt = 0

  /**
   * Slow down password and recovery-key guessing in the app. (Someone who copies the
   * files bypasses this; against them Argon2id's cost is the protection.)
   */
  private checkThrottle(): void {
    const wait = this.nextAttemptAt - Date.now()
    if (wait > 0) {
      throw new UserError('too-many-attempts', `Too many failed attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`)
    }
  }

  private recordFailure(): void {
    this.failedAttempts++
    if (this.failedAttempts >= FREE_ATTEMPTS) {
      this.nextAttemptAt = Date.now() + Math.min(2 ** (this.failedAttempts - FREE_ATTEMPTS + 1) * 1000, MAX_DELAY_MS)
    }
  }

  private recordSuccess(): void {
    this.failedAttempts = 0
    this.nextAttemptAt = 0
  }

  /** Set while this computer waits for approval to join (so commits carry the right author). */
  private pendingMe: MemberSummary | null = null

  private get pendingFile(): string {
    return join(this.opts.dataDir, 'join-pending.json')
  }

  private async readPendingId(): Promise<string | null> {
    try {
      return (JSON.parse(await readFile(this.pendingFile, 'utf8')) as { memberId: string }).memberId
    } catch {
      return null
    }
  }

  async getState(): Promise<VaultState> {
    if (this.open) return { status: 'unlocked', me: this.open.me }
    if (!(await this.files.readHeader())) return { status: 'no-vault' }
    const pendingId = await this.readPendingId()
    if (pendingId) {
      const mine = (await this.files.listMembers()).find((m) => m.id === pendingId)
      if (mine && !mine.sealedVaultKey) {
        this.pendingMe = { id: mine.id, name: mine.name }
        return { status: 'pending', member: this.pendingMe, fingerprint: await fingerprint(mine.publicKey) }
      }
      await rm(this.pendingFile, { force: true }) // approved (or removed): back to normal
      this.pendingMe = null
    }
    const members = (await this.files.listMembers()).filter((m) => m.sealedVaultKey).map(({ id, name }) => ({ id, name }))
    return { status: 'locked', members }
  }

  async createVault(name: string, password: string): Promise<{ recoveryKey: string }> {
    if (await this.files.readHeader()) throw new UserError('exists', 'A vault already exists on this computer')
    name = name.trim()
    if (!name) throw new UserError('name-required', 'Enter your name')
    this.checkPassword(password)
    const v = await createVault({ adminName: name, password, kdf: this.opts.kdf })
    await this.files.writeHeader(v.header)
    await this.files.writeMember(v.member)
    v.session.close()
    await this.git.init()
    await this.git.commitAll('Create vault')
    return { recoveryKey: v.recoveryKey }
  }

  async unlock(memberId: string, password: string): Promise<{ unreadable: number }> {
    this.lock()
    const header = await this.files.readHeader()
    const member = (await this.files.listMembers()).find((m) => m.id === memberId)
    if (!header || !member) throw new UserError('not-found', 'Member not found')
    this.checkThrottle()
    let session: VaultSession
    try {
      session = await unlockWithPassword(header, member, password)
      this.recordSuccess()
    } catch (e) {
      if (e instanceof VaultError && e.code === 'wrong-password') {
        this.recordFailure()
        throw new UserError('wrong-password', 'Wrong password')
      }
      if (e instanceof VaultError) throw new UserError(e.code, e.message)
      throw e
    }
    return this.start(header, member, session)
  }

  private checkPassword(password: string): void {
    if (password.length < MIN_PASSWORD) {
      throw new UserError('weak-password', `The password must be at least ${MIN_PASSWORD} characters`)
    }
  }

  private get trustFile(): string {
    return join(this.opts.dataDir, 'trusted-key.json')
  }

  private async readPin(vaultId: string): Promise<{ generation: number; keyFingerprint: string } | null> {
    try {
      const pins = JSON.parse(await readFile(this.trustFile, 'utf8')) as Record<string, { generation: number; keyFingerprint: string }>
      return pins[vaultId] ?? null
    } catch {
      return null
    }
  }

  private async writePin(vaultId: string, session: VaultSession): Promise<void> {
    let pins: Record<string, unknown> = {}
    try {
      pins = JSON.parse(await readFile(this.trustFile, 'utf8')) as Record<string, unknown>
    } catch {
      // first time
    }
    pins[vaultId] = { generation: session.generation, keyFingerprint: await session.keyFingerprint() }
    await writeFile(this.trustFile, JSON.stringify(pins, null, 2))
  }

  /**
   * Refuse a vault key this computer cannot verify: it must be the key trusted last
   * time or reachable from it through the key chain, and the member file must be
   * vouched for by it. Defends against someone with write access to the GitHub
   * repository (but not the vault) planting their own key.
   */
  private async checkTrust(header: VaultHeader, member: MemberFile, session: VaultSession): Promise<void> {
    const pin = await this.readPin(header.vaultId)
    try {
      if (pin) await verifyKeyHistory(session, header, pin)
      if (!(await verifyMember(session, member))) {
        throw new VaultError('tampered', 'Your member file was modified by someone without access to the vault')
      }
    } catch (e) {
      session.close()
      if (e instanceof VaultError) {
        throw new UserError('tampered', `Refusing to unlock: ${e.message}. Ask another member to check the GitHub repository.`)
      }
      throw e
    }
  }

  private async removeIndex(vaultId: string): Promise<void> {
    for (const suffix of ['', '-wal', '-shm']) {
      await rm(join(this.opts.dataDir, `index-${vaultId}.db${suffix}`), { force: true })
    }
  }

  /**
   * The index is keyed from the vault key, so after a key change (here or on another
   * computer) the old file cannot be opened. It is only a cache: start a new one.
   */
  private async openIndex(vaultId: string, session: VaultSession): Promise<IndexDb> {
    const file = join(this.opts.dataDir, `index-${vaultId}.db`)
    try {
      return IndexDb.open(file, await session.sqliteKey())
    } catch {
      await this.removeIndex(vaultId)
      return IndexDb.open(file, await session.sqliteKey())
    }
  }

  /** Open the local index for an unlocked session and bring it up to date. */
  private async start(header: VaultHeader, member: MemberFile, session: VaultSession): Promise<{ unreadable: number }> {
    await this.checkTrust(header, member, session)
    const vaultId = header.vaultId
    const firstTime = !(await this.readPin(vaultId))
    const index = await this.openIndex(vaultId, session)
    const repo = new EntryRepository(session, this.files, index, member.id)
    this.open = { session, index, repo, me: { id: member.id, name: member.name }, vaultId, staged: new Map() }
    const report = await repo.rebuild()
    // First unlock on this computer (nothing to compare with yet): a key that reads none of the
    // existing entries is not the real vault key.
    if (firstTime && report.failed.length > 0 && report.added.length + report.updated.length + report.unchanged === 0) {
      this.lock()
      throw new UserError('tampered', 'Refusing to unlock: this key cannot read any of the existing entries. Ask another member to check the GitHub repository.')
    }
    await this.writePin(vaultId, session)
    this.touch()
    this.remoteUrl = (await this.git.isRepo()) ? await this.git.remoteUrl() : null
    if (this.opts.autoSync && this.remoteUrl) {
      this.scheduleSync(0)
      this.syncInterval = setInterval(() => this.scheduleSync(0), SYNC_INTERVAL_MS)
    }
    return { unreadable: report.failed.length }
  }

  lock(): void {
    clearTimeout(this.idleTimer)
    clearTimeout(this.syncTimer)
    clearInterval(this.syncInterval)
    const o = this.open
    if (!o) return
    this.open = null
    o.staged.clear()
    o.index.close()
    o.session.close()
    this.opts.onLocked?.()
  }

  /** Postpone the idle auto-lock. */
  touch(): void {
    clearTimeout(this.idleTimer)
    const ms = this.opts.idleMs ?? 0
    if (this.open && ms > 0) this.idleTimer = setTimeout(() => this.lock(), ms)
  }

  private unlocked(): Unlocked {
    if (!this.open) throw new UserError('locked', 'The vault is locked')
    return this.open
  }

  list(args: { type?: Entry['type']; query?: string }): EntrySummary[] {
    return this.unlocked()
      .repo.list(args)
      .map((r) => ({ id: r.id, type: r.type, title: r.title, tags: r.tags, favorite: r.favorite, updatedAt: r.updatedAt, updatedBy: r.updatedBy, ...(r.conflictOf ? { conflictOf: r.conflictOf } : {}) }))
  }

  get(id: string): Entry | null {
    return this.unlocked().repo.get(id)
  }

  async save(id: string | undefined, rawInput: unknown): Promise<Entry> {
    const o = this.unlocked()
    let input: EntryInput
    try {
      input = parseEntryInput(rawInput)
    } catch (e) {
      throw new UserError('invalid', (e as Error).message)
    }
    const current = id ? o.repo.get(id) : null
    if (id && !current) throw new UserError('not-found', 'Entry not found')

    // Attachments must be either freshly added (staged) or already on this entry. Size and type
    // come from what we stored, never from the renderer; only the display name may change.
    const known = new Map((current?.attachments ?? []).map((a) => [a.id, a]))
    const toWrite: { id: string; bytes: Uint8Array }[] = []
    input.attachments = input.attachments.map((a) => {
      const staged = o.staged.get(a.id)
      if (staged) {
        toWrite.push({ id: a.id, bytes: staged.bytes })
        return { ...staged.ref, name: a.name }
      }
      const existing = known.get(a.id)
      if (!existing) throw new UserError('invalid', 'Unknown attachment')
      return { ...existing, name: a.name }
    })

    // Blob files first, so a saved entry never points to a missing file.
    for (const b of toWrite) await this.files.writeBlob(b.id, b.bytes)
    const entry = id ? await o.repo.update(id, input) : await o.repo.create(input)
    for (const b of toWrite) o.staged.delete(b.id)
    await this.collectBlobs((current?.attachments ?? []).map((a) => a.id))
    await this.afterChange()
    return entry
  }

  async delete(id: string): Promise<void> {
    const { repo } = this.unlocked()
    const before = repo.get(id)
    await repo.delete(id)
    await this.collectBlobs(before?.attachments.map((a) => a.id) ?? [])
    await this.afterChange()
  }

  async resolveConflict(id: string, keepCopy: boolean): Promise<void> {
    const { repo } = this.unlocked()
    const copy = repo.get(id)
    const original = copy?.conflictOf ? repo.get(copy.conflictOf) : null
    try {
      await repo.resolveConflict(id, keepCopy)
    } catch (e) {
      throw new UserError('invalid', (e as Error).message)
    }
    await this.collectBlobs([...(copy?.attachments ?? []), ...(original?.attachments ?? [])].map((a) => a.id))
    await this.afterChange()
  }

  /** Delete those blob files that no entry references any more (copies from conflicts can share blobs). */
  private async collectBlobs(candidates: string[]): Promise<void> {
    if (candidates.length === 0) return
    const used = this.unlocked().index.referencedBlobIds()
    for (const id of candidates) if (!used.has(id)) await this.files.deleteBlob(id)
  }

  // ---- Attachments ---------------------------------------------------------

  /** Encrypt a file into memory; it becomes part of the vault when the entry is saved. */
  async addAttachment(name: string, data: Uint8Array, mime = mimeFor(name)): Promise<AttachmentRef> {
    const o = this.unlocked()
    if (data.length > MAX_ATTACHMENT_BYTES) {
      throw new UserError('too-large', `${name} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`)
    }
    const ref: AttachmentRef = { id: randomUUID(), name: basename(name), size: data.length, mime }
    o.staged.set(ref.id, { ref, bytes: await encryptBlob(o.session, ref.id, data) })
    return ref
  }

  async addAttachmentFromPath(path: string): Promise<AttachmentRef> {
    this.unlocked()
    const info = await stat(path)
    if (!info.isFile()) throw new UserError('invalid', 'Not a file')
    if (info.size > MAX_ATTACHMENT_BYTES) {
      throw new UserError('too-large', `${basename(path)} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`)
    }
    const data = new Uint8Array(await readFile(path))
    try {
      return await this.addAttachment(basename(path), data)
    } finally {
      data.fill(0)
    }
  }

  /** Decrypted content of a staged attachment or one referenced by an entry. */
  async readAttachment(id: string): Promise<{ ref: AttachmentRef; data: Uint8Array }> {
    const o = this.unlocked()
    const staged = o.staged.get(id)
    if (staged) return { ref: staged.ref, data: await decryptBlob(o.session, id, staged.bytes) }
    const ref = o.repo
      .list()
      .map((r) => o.repo.get(r.id))
      .flatMap((e) => e?.attachments ?? [])
      .find((a) => a.id === id)
    if (!ref) throw new UserError('not-found', 'Attachment not found')
    const bytes = await this.files.readBlob(id)
    if (!bytes) throw new UserError('missing', `The file for ${ref.name} is missing (not synced yet?)`)
    try {
      return { ref, data: await decryptBlob(o.session, id, bytes) }
    } catch (e) {
      throw new UserError(e instanceof VaultError ? e.code : 'unreadable', `${ref.name} cannot be read`)
    }
  }

  async previewAttachment(id: string): Promise<AttachmentPreview> {
    const { ref, data } = await this.readAttachment(id)
    try {
      return previewFor(ref.mime, data)
    } finally {
      data.fill(0)
    }
  }


  // ---- Members -------------------------------------------------------------

  /** A new person on a new computer: fetch the vault from GitHub and ask an admin for access. */
  async joinVault(args: { url: string; token: string; name: string; password: string }): Promise<{ fingerprint: string }> {
    if (await this.files.readHeader()) throw new UserError('exists', 'A vault already exists on this computer')
    const url = args.url.trim()
    const name = args.name.trim()
    const token = args.token.trim()
    if (!(this.opts.allowedRemote ?? GITHUB_URL).test(url)) {
      throw new UserError('invalid-url', 'Enter the repository address, like https://github.com/your-church/vault')
    }
    if (!name) throw new UserError('name-required', 'Enter your name')
    if (!token) throw new UserError('invalid', 'Enter the access token')
    this.checkPassword(args.password)

    await this.opts.secrets.set(TOKEN_KEY, token)
    try {
      await rm(this.opts.repoDir, { recursive: true, force: true })
      await mkdir(this.opts.dataDir, { recursive: true })
      await this.git.clone(url).catch((e) => {
        throw new UserError(e instanceof SyncError ? e.code : 'unknown', (e as Error).message)
      })
      if (!(await this.files.readHeader())) {
        throw new UserError('not-a-vault', 'That repository does not contain a ChurchVault')
      }
      const member = await createMemberIdentity({ name, password: args.password, kdf: this.opts.kdf })
      await this.files.writeMember(member)
      await writeFile(this.pendingFile, JSON.stringify({ memberId: member.id }))
      this.pendingMe = { id: member.id, name: member.name }
      await this.git.init() // adds .gitignore
      await this.git.commitAll('Request access')
      await this.git.sync() // upload the request
      return { fingerprint: await fingerprint(member.publicKey) }
    } catch (e) {
      await rm(this.opts.repoDir, { recursive: true, force: true })
      await rm(this.pendingFile, { force: true })
      await this.opts.secrets.delete(TOKEN_KEY)
      this.pendingMe = null
      if (e instanceof SyncError) throw new UserError(e.code, e.message)
      throw e
    }
  }

  /** While waiting for approval: fetch from GitHub, then report the (possibly changed) state. */
  async checkApproval(): Promise<VaultState> {
    if ((await this.getState()).status === 'pending') {
      try {
        await this.git.sync()
      } catch (e) {
        if (e instanceof SyncError) throw new UserError(e.code, e.message)
        throw e
      }
    }
    return this.getState()
  }

  async listMembers(): Promise<MemberInfo[]> {
    const { me, session } = this.unlocked()
    const members = await this.files.listMembers()
    return Promise.all(
      members.map(async (m) => ({
        id: m.id,
        name: m.name,
        pending: !m.sealedVaultKey,
        fingerprint: await fingerprint(m.publicKey),
        isMe: m.id === me.id,
        verified: !!m.sealedVaultKey && (await verifyMember(session, m))
      }))
    )
  }

  /** Give a waiting person access. The caller must have compared fingerprints with them. */
  async approveMember(id: string): Promise<void> {
    const { session } = this.unlocked()
    const pending = (await this.files.listMembers()).find((m) => m.id === id)
    if (!pending) throw new UserError('not-found', 'Member not found')
    if (pending.sealedVaultKey) throw new UserError('invalid', `${pending.name} already has access`)
    await this.files.writeMember(await grantAccess(session, pending))
    await this.afterChange()
  }

  /**
   * Remove a member and change the vault key so they cannot read anything written from now on.
   * Everything is re-encrypted first and written afterwards; if writing fails the
   * working tree is reset to the last commit.
   */
  async removeMember(id: string): Promise<{ recoveryKey: string | null }> {
    const o = this.unlocked()
    const members = await this.files.listMembers()
    const target = members.find((m) => m.id === id)
    if (!target) throw new UserError('not-found', 'Member not found')
    if (id === o.me.id) throw new UserError('invalid', 'You cannot remove yourself')
    if (!target.sealedVaultKey) {
      // Declining a request: that person never had the key, so nothing needs re-encrypting.
      await this.files.deleteMember(id)
      await this.afterChange()
      return { recoveryKey: null }
    }
    const remaining = members.filter((m) => m.id !== id)
    if (!remaining.some((m) => m.sealedVaultKey)) throw new UserError('invalid', 'At least one member with access must remain')

    // Start from the latest state of everyone's work, and a clean commit to fall back on.
    if (this.remoteUrl) {
      const status = await this.syncNow()
      if (status.lastError) throw new UserError(status.lastError.code, `Sync first: ${status.lastError.message}`)
      if (!this.open || this.open !== o) throw new UserError('locked', 'The vault key changed while syncing; unlock and try again')
    }
    await this.git.commitAll('Update vault')
    const header = await this.files.readHeader()
    if (!header) throw new UserError('not-found', 'Vault not found')

    // 1. Prepare everything in memory.
    let rotation: Awaited<ReturnType<typeof rotateVaultKey>>
    try {
      rotation = await rotateVaultKey(o.session, header, remaining)
    } catch (e) {
      if (e instanceof VaultError && e.code === 'untrusted-member') {
        throw new UserError('untrusted-member', `${e.message}. Remove that member first (it may have been tampered with), then try again.`)
      }
      throw e
    }
    const rekeyed: { id: string; envelope: Awaited<ReturnType<typeof rekeyEntry>> }[] = []
    let unreadable = 0
    for (const entryId of await this.files.listEntryIds()) {
      const file = await this.files.readEntry(entryId)
      if (!file) continue
      try {
        rekeyed.push({ id: entryId, envelope: await rekeyEntry(o.session, rotation.session, entryId, file.envelope) })
      } catch {
        unreadable++
      }
    }
    // Attachments are re-encrypted one at a time into a scratch folder to keep memory use low.
    // Blob files no entry references are dropped instead.
    const scratch = join(this.opts.dataDir, 'rotation')
    await rm(scratch, { recursive: true, force: true })
    await mkdir(scratch, { recursive: true })
    const used = o.index.referencedBlobIds()
    const blobs: string[] = []
    const orphans: string[] = []
    for (const blobId of await this.files.listBlobIds()) {
      if (!used.has(blobId)) {
        orphans.push(blobId)
        continue
      }
      const bytes = await this.files.readBlob(blobId)
      try {
        await writeFile(join(scratch, blobId), await rekeyBlob(o.session, rotation.session, blobId, bytes!))
        blobs.push(blobId)
      } catch {
        unreadable++
      }
    }
    if (unreadable > 0) {
      rotation.session.close()
      await rm(scratch, { recursive: true, force: true })
      throw new UserError('rotation-blocked', `${unreadable} entries or attachments cannot be read, so the key cannot be changed safely. Sync and try again.`)
    }
    o.staged.clear() // unsaved attachments were encrypted with the old key

    // 2. Write it all.
    try {
      for (const blobId of blobs) await this.files.writeBlob(blobId, new Uint8Array(await readFile(join(scratch, blobId))))
      for (const blobId of orphans) await this.files.deleteBlob(blobId)
      for (const r of rekeyed) await this.files.writeEntry(r.id, r.envelope)
      for (const m of rotation.members) await this.files.writeMember(m)
      await this.files.deleteMember(id)
      await this.files.writeHeader(rotation.header)
    } catch (e) {
      rotation.session.close()
      await this.git.discardUncommitted()
      throw e
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }

    // 3. Switch this computer to the new key. The index is keyed from the vault key, so it starts over.
    const me = members.find((m) => m.id === o.me.id)!
    o.index.close()
    o.session.close()
    await this.removeIndex(o.vaultId)
    this.open = null
    await this.start(rotation.header, rotation.members.find((m) => m.id === me.id)!, rotation.session)
    await this.git.commitAll('Change vault key')
    if (this.remoteUrl) await this.syncNow() // publish at once rather than after the usual delay
    return { recoveryKey: rotation.recoveryKey }
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const { me } = this.unlocked()
    this.checkPassword(newPassword)
    const member = (await this.files.listMembers()).find((m) => m.id === me.id)
    if (!member) throw new UserError('not-found', 'Member not found')
    try {
      await this.files.writeMember(await changePassword(member, oldPassword, newPassword, this.opts.kdf))
    } catch (e) {
      if (e instanceof VaultError && e.code === 'wrong-password') throw new UserError('wrong-password', 'Wrong current password')
      throw e
    }
    await this.afterChange()
  }

  /** Forgotten password: the recovery key opens the vault and gives this member a fresh password. */
  async recoverAccess(memberId: string, recoveryKey: string, newPassword: string): Promise<{ unreadable: number }> {
    this.lock()
    this.checkPassword(newPassword)
    const header = await this.files.readHeader()
    const member = (await this.files.listMembers()).find((m) => m.id === memberId)
    if (!header || !member) throw new UserError('not-found', 'Member not found')
    this.checkThrottle()
    let session: VaultSession
    try {
      session = await unlockWithRecoveryKey(header, recoveryKey)
      this.recordSuccess()
    } catch (e) {
      if (e instanceof VaultError && e.code === 'wrong-recovery-key') this.recordFailure()
      if (e instanceof VaultError) throw new UserError(e.code, e.message)
      throw e
    }
    const updated = await resetMember(session, member, newPassword, this.opts.kdf)
    const pin = await this.readPin(header.vaultId)
    if (pin) {
      try {
        await verifyKeyHistory(session, header, pin)
      } catch (e) {
        session.close()
        throw new UserError('tampered', `Refusing to recover: ${(e as Error).message}`)
      }
    }
    await this.files.writeMember(updated)
    const result = await this.start(header, updated, session)
    await this.afterChange()
    return result
  }

  // ---- Git sync ----------------------------------------------------------

  /** Record the change in Git right away (local, cheap), and sync soon if a remote is set up. */
  private async afterChange(): Promise<void> {
    // Commit messages carry no entry titles or ids: Git history is visible to GitHub.
    await this.git.commitAll('Update vault')
    if (this.opts.autoSync && this.remoteUrl) this.scheduleSync(SYNC_DEBOUNCE_MS)
  }

  private scheduleSync(ms: number): void {
    clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => void this.syncNow(), ms)
  }

  getSyncStatus(): SyncStatus {
    return {
      configured: this.remoteUrl !== null,
      remoteUrl: this.remoteUrl,
      syncing: this.syncing !== null,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError
    }
  }

  private emitStatus(): SyncStatus {
    const s = this.getSyncStatus()
    this.opts.onSyncStatus?.(s)
    return s
  }

  /** Validate and store the GitHub address + token, then run the first sync. */
  async connectRemote(url: string, token: string): Promise<SyncStatus> {
    this.unlocked()
    url = url.trim()
    token = token.trim()
    if (!(this.opts.allowedRemote ?? GITHUB_URL).test(url)) {
      throw new UserError('invalid-url', 'Enter the repository address, like https://github.com/your-church/vault')
    }
    if (!token) throw new UserError('invalid', 'Enter the access token')
    // Credentials are only ever sent to github.com (checked above), never to another host.
    await this.git.init()
    await this.git.commitAll('Initial vault')
    await this.git.setRemote(url)
    await this.opts.secrets.set(TOKEN_KEY, token)
    this.remoteUrl = url
    try {
      const status = await this.syncNow()
      if (status.lastError) throw new UserError(status.lastError.code, status.lastError.message)
      if (this.opts.autoSync) {
        this.syncInterval = setInterval(() => this.scheduleSync(0), SYNC_INTERVAL_MS)
      }
      return status
    } catch (e) {
      await this.dropRemote()
      throw e
    }
  }

  /** Replace the GitHub token (e.g. it expired). The old one is kept if the new one does not work. */
  async updateToken(token: string): Promise<SyncStatus> {
    this.unlocked()
    token = token.trim()
    if (!this.remoteUrl) throw new UserError('no-remote', 'GitHub is not set up yet')
    if (!token) throw new UserError('invalid', 'Enter the access token')
    const previous = await this.opts.secrets.get(TOKEN_KEY)
    await this.opts.secrets.set(TOKEN_KEY, token)
    const status = await this.syncNow()
    if (status.lastError?.code === 'auth') {
      if (previous) await this.opts.secrets.set(TOKEN_KEY, previous)
      throw new UserError('auth', status.lastError.message)
    }
    return status
  }

  async disconnectRemote(): Promise<SyncStatus> {
    this.unlocked()
    await this.dropRemote()
    return this.emitStatus()
  }

  private async dropRemote(): Promise<void> {
    clearTimeout(this.syncTimer)
    clearInterval(this.syncInterval)
    await this.git.clearRemote()
    await this.opts.secrets.delete(TOKEN_KEY)
    this.remoteUrl = null
    this.lastError = null
    this.lastSyncAt = null
  }

  /** Commit, pull, merge, push. Concurrent calls share one run. Never throws: errors land in the status. */
  async syncNow(): Promise<SyncStatus> {
    const { repo, session } = this.unlocked()
    if (!this.remoteUrl) throw new UserError('no-remote', 'GitHub is not set up yet')
    if (this.syncing) return this.syncing
    this.syncing = (async () => {
      this.emitStatus()
      try {
        await this.git.sync({
          onMerged: async (result) => {
            await repo.rebuild()
            for (const c of result.conflicts) {
              try {
                const ours = await decryptEntry<Entry>(session, c.id, c.ours)
                await repo.createConflictCopy(ours, c.id)
              } catch {
                // Cannot read our version (e.g. made under an older vault key); the remote version stays.
              }
            }
          }
        })
        this.lastSyncAt = new Date().toISOString()
        this.lastError = null
        // Someone changed the vault key (a member was removed): this unlock is outdated.
        const header = await this.files.readHeader()
        if (header && header.generation !== session.generation) {
          this.syncing = null
          this.lock()
          return this.emitStatus()
        }
      } catch (e) {
        const err = e instanceof SyncError ? e : new SyncError('unknown', 'Sync failed')
        this.lastError = { code: err.code, message: err.message }
      } finally {
        this.syncing = null
      }
      return this.emitStatus()
    })()
    return this.syncing
  }
}
