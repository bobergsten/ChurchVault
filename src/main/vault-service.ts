import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HttpClient } from 'isomorphic-git'
import type { Entry } from '@shared/entry'
import { parseEntryInput } from '@shared/entry-validate'
import type { EntrySummary, MemberInfo, MemberSummary, SyncStatus, VaultState } from '@shared/api'
import type { KdfParams, MemberFile } from '@shared/vault-format'
import {
  VaultError,
  changePassword,
  createMemberIdentity,
  createVault,
  decryptEntry,
  fingerprint,
  grantAccess,
  rekeyEntry,
  resetMember,
  rotateVaultKey,
  unlockWithPassword,
  unlockWithRecoveryKey,
  type VaultSession
} from './crypto'
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
}

const MIN_PASSWORD = 10

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
    let session: VaultSession
    try {
      session = await unlockWithPassword(header, member, password)
    } catch (e) {
      if (e instanceof VaultError && e.code === 'wrong-password') throw new UserError('wrong-password', 'Wrong password')
      if (e instanceof VaultError) throw new UserError(e.code, e.message)
      throw e
    }
    return this.start(header.vaultId, member, session)
  }

  private checkPassword(password: string): void {
    if (password.length < MIN_PASSWORD) {
      throw new UserError('weak-password', `The password must be at least ${MIN_PASSWORD} characters`)
    }
  }

  /** Open the local index for an unlocked session and bring it up to date. */
  private async start(vaultId: string, member: MemberFile, session: VaultSession): Promise<{ unreadable: number }> {
    const index = IndexDb.open(join(this.opts.dataDir, `index-${vaultId}.db`), await session.sqliteKey())
    const repo = new EntryRepository(session, this.files, index, member.id)
    this.open = { session, index, repo, me: { id: member.id, name: member.name }, vaultId }
    const report = await repo.rebuild()
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
    const { repo } = this.unlocked()
    let input
    try {
      input = parseEntryInput(rawInput)
    } catch (e) {
      throw new UserError('invalid', (e as Error).message)
    }
    const entry = id ? await repo.update(id, input) : await repo.create(input)
    await this.afterChange()
    return entry
  }

  async delete(id: string): Promise<void> {
    await this.unlocked().repo.delete(id)
    await this.afterChange()
  }

  async resolveConflict(id: string, keepCopy: boolean): Promise<void> {
    try {
      await this.unlocked().repo.resolveConflict(id, keepCopy)
    } catch (e) {
      throw new UserError('invalid', (e as Error).message)
    }
    await this.afterChange()
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
    const { me } = this.unlocked()
    const members = await this.files.listMembers()
    return Promise.all(
      members.map(async (m) => ({
        id: m.id,
        name: m.name,
        pending: !m.sealedVaultKey,
        fingerprint: await fingerprint(m.publicKey),
        isMe: m.id === me.id
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
    const rotation = await rotateVaultKey(o.session, header, remaining)
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
    if (unreadable > 0) {
      rotation.session.close()
      throw new UserError('rotation-blocked', `${unreadable} entries cannot be read, so the key cannot be changed safely. Sync and try again.`)
    }

    // 2. Write it all (TODO milestone 7: re-encrypt attachment blobs here as well).
    try {
      for (const r of rekeyed) await this.files.writeEntry(r.id, r.envelope)
      for (const m of rotation.members) await this.files.writeMember(m)
      await this.files.deleteMember(id)
      await this.files.writeHeader(rotation.header)
    } catch (e) {
      rotation.session.close()
      await this.git.discardUncommitted()
      throw e
    }

    // 3. Switch this computer to the new key. The index is keyed from the vault key, so it starts over.
    const me = members.find((m) => m.id === o.me.id)!
    o.index.close()
    o.session.close()
    await rm(join(this.opts.dataDir, `index-${o.vaultId}.db`), { force: true })
    await rm(join(this.opts.dataDir, `index-${o.vaultId}.db-wal`), { force: true })
    await rm(join(this.opts.dataDir, `index-${o.vaultId}.db-shm`), { force: true })
    this.open = null
    await this.start(o.vaultId, me, rotation.session)
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
    let session: VaultSession
    try {
      session = await unlockWithRecoveryKey(header, recoveryKey)
    } catch (e) {
      if (e instanceof VaultError) throw new UserError(e.code, e.message)
      throw e
    }
    const updated = await resetMember(session, member, newPassword, this.opts.kdf)
    await this.files.writeMember(updated)
    const result = await this.start(header.vaultId, updated, session)
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
