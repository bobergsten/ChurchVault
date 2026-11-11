import { join } from 'node:path'
import type { HttpClient } from 'isomorphic-git'
import type { Entry } from '@shared/entry'
import { parseEntryInput } from '@shared/entry-validate'
import type { EntrySummary, MemberSummary, SyncStatus, VaultState } from '@shared/api'
import type { KdfParams } from '@shared/vault-format'
import {
  VaultError,
  createVault,
  decryptEntry,
  unlockWithPassword,
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
}

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
      author: () => ({
        name: this.open?.me.name ?? 'ChurchVault',
        email: `${this.open?.me.id ?? 'unknown'}@members.churchvault.invalid`
      })
    })
  }

  async getState(): Promise<VaultState> {
    if (this.open) return { status: 'unlocked', me: this.open.me }
    if (!(await this.files.readHeader())) return { status: 'no-vault' }
    const members = (await this.files.listMembers()).filter((m) => m.sealedVaultKey).map(({ id, name }) => ({ id, name }))
    return { status: 'locked', members }
  }

  async createVault(name: string, password: string): Promise<{ recoveryKey: string }> {
    if (await this.files.readHeader()) throw new UserError('exists', 'A vault already exists on this computer')
    name = name.trim()
    if (!name) throw new UserError('name-required', 'Enter your name')
    if (password.length < 10) throw new UserError('weak-password', 'The password must be at least 10 characters')
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
    const index = IndexDb.open(join(this.opts.dataDir, `index-${header.vaultId}.db`), await session.sqliteKey())
    const repo = new EntryRepository(session, this.files, index, member.id)
    this.open = { session, index, repo, me: { id: member.id, name: member.name } }
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
