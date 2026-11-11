import { join } from 'node:path'
import type { Entry } from '@shared/entry'
import { parseEntryInput } from '@shared/entry-validate'
import type { EntrySummary, MemberSummary, VaultState } from '@shared/api'
import type { KdfParams } from '@shared/vault-format'
import {
  VaultError,
  createVault,
  unlockWithPassword,
  type VaultSession
} from './crypto'
import { EntryRepository, FileStore, IndexDb } from './storage'

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
}

interface Unlocked {
  session: VaultSession
  index: IndexDb
  repo: EntryRepository
  me: MemberSummary
}

/** The vault as used by the app: owns the unlocked session and everything derived from it. */
export class VaultService {
  private readonly files: FileStore
  private open: Unlocked | null = null
  private idleTimer: NodeJS.Timeout | undefined

  constructor(private readonly opts: VaultServiceOptions) {
    this.files = new FileStore(opts.repoDir)
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
    return { unreadable: report.failed.length }
  }

  lock(): void {
    clearTimeout(this.idleTimer)
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
      .map((r) => ({ id: r.id, type: r.type, title: r.title, tags: r.tags, favorite: r.favorite, updatedAt: r.updatedAt, updatedBy: r.updatedBy }))
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
    return id ? repo.update(id, input) : repo.create(input)
  }

  delete(id: string): Promise<void> {
    return this.unlocked().repo.delete(id)
  }
}
