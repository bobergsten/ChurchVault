import { randomUUID } from 'node:crypto'
import type { Entry, EntryInput, EntryType } from '@shared/entry'
import { VaultError, decryptEntry, encryptEntry, type VaultSession } from '../crypto'
import { FileStore } from './file-store'
import { IndexDb, type IndexRow } from './index-db'

export interface RebuildReport {
  added: string[]
  updated: string[]
  removed: string[]
  unchanged: number
  /** Files that could not be decrypted (corrupt, or from another key generation). */
  failed: { id: string; code: string }[]
}

/**
 * Entries as the app sees them: encrypted files in the repo (source of truth)
 * plus a searchable local index. Writes go to the file first; the index follows.
 */
export class EntryRepository {
  constructor(
    private readonly session: VaultSession,
    private readonly files: FileStore,
    private readonly index: IndexDb,
    /** id of the signed-in member, recorded in `updatedBy` */
    private readonly memberId: string
  ) {}

  async create(input: EntryInput): Promise<Entry> {
    const now = new Date().toISOString()
    const entry = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      updatedBy: this.memberId,
      rev: 1
    } as Entry
    await this.persist(entry)
    return entry
  }

  /** Replace an entry's content. The type cannot change. */
  async update(id: string, input: EntryInput): Promise<Entry> {
    const current = this.index.get(id)
    if (!current) throw new Error(`No such entry: ${id}`)
    if (current.type !== input.type) throw new Error('Entry type cannot be changed')
    const entry = {
      ...input,
      id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      updatedBy: this.memberId,
      rev: current.rev + 1,
      ...(current.conflictOf ? { conflictOf: current.conflictOf } : {})
    } as Entry
    await this.persist(entry)
    return entry
  }

  /** Preserve a version that lost an edit conflict as a separate, flagged entry. */
  async createConflictCopy(ours: Entry, originalId: string): Promise<Entry> {
    const copy = {
      ...ours,
      id: randomUUID(),
      updatedBy: this.memberId,
      rev: 1,
      conflictOf: originalId
    } as Entry
    await this.persist(copy)
    return copy
  }

  /** `keepCopy`: the copy's content replaces the original. Otherwise the copy is dropped. */
  async resolveConflict(copyId: string, keepCopy: boolean): Promise<void> {
    const copy = this.index.get(copyId)
    if (!copy?.conflictOf) throw new Error('Not a conflict copy')
    const original = this.index.get(copy.conflictOf)
    if (keepCopy) {
      const { id: _id, createdAt: _c, updatedAt: _u, updatedBy: _b, rev: _r, conflictOf: _o, ...input } = copy
      if (original) {
        await this.update(original.id, input as EntryInput)
      } else {
        // The original no longer exists: the copy simply becomes a normal entry.
        const { conflictOf: _drop, ...rest } = copy
        await this.persist({ ...rest, rev: copy.rev + 1, updatedAt: new Date().toISOString(), updatedBy: this.memberId } as Entry)
        return
      }
    }
    await this.delete(copyId)
  }

  async delete(id: string): Promise<void> {
    await this.files.deleteEntry(id)
    this.index.remove(id)
  }

  get(id: string): Entry | null {
    return this.index.get(id)
  }

  list(opts?: { type?: EntryType; query?: string }): IndexRow[] {
    return this.index.list(opts)
  }

  private async persist(entry: Entry): Promise<void> {
    const envelope = await encryptEntry(this.session, entry.id, entry)
    const hash = await this.files.writeEntry(entry.id, envelope)
    this.index.upsert(entry, hash)
  }

  /**
   * Bring the index in line with the files, e.g. after a Git pull or on first
   * launch on a new machine. Only files whose content hash changed are decrypted.
   */
  async rebuild(): Promise<RebuildReport> {
    const report: RebuildReport = { added: [], updated: [], removed: [], unchanged: 0, failed: [] }
    const known = this.index.hashes()
    const ids = await this.files.listEntryIds()
    for (const id of ids) {
      const file = await this.files.readEntry(id)
      if (!file) continue
      const before = known.get(id)
      known.delete(id)
      if (before === file.hash) {
        report.unchanged++
        continue
      }
      try {
        const entry = await decryptEntry<Entry>(this.session, id, file.envelope)
        if (entry.id !== id) throw new VaultError('tampered', 'Entry id does not match file name')
        this.index.upsert(entry, file.hash)
        ;(before === undefined ? report.added : report.updated).push(id)
      } catch (e) {
        report.failed.push({ id, code: e instanceof VaultError ? e.code : 'unreadable' })
      }
    }
    // Whatever is left in `known` no longer has a file.
    for (const id of known.keys()) {
      this.index.remove(id)
      report.removed.push(id)
    }
    return report
  }
}
