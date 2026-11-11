import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ENTRY_ID_PATTERN } from '@shared/entry'
import type { EntryEnvelope, MemberFile, VaultHeader } from '@shared/vault-format'

const ENTRY_EXT = '.vault'
const BLOB_EXT = '.bin'

export function assertEntryId(id: string): void {
  if (!ENTRY_ID_PATTERN.test(id)) throw new Error(`Invalid entry id: ${id}`)
}

/**
 * The working tree of the Git repository: vault.json, members/*.json, entries/*.vault.
 * Only ciphertext and public data are written here. Writes are atomic so a crash
 * never leaves a half-written file that Git would commit.
 */
export class FileStore {
  constructor(readonly root: string) {}

  private path(...parts: string[]): string {
    return join(this.root, ...parts)
  }

  private async writeAtomic(file: string, data: string): Promise<void> {
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, data, 'utf8')
    await rename(tmp, file)
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  async init(): Promise<void> {
    await mkdir(this.path('entries'), { recursive: true })
    await mkdir(this.path('members'), { recursive: true })
    await mkdir(this.path('blobs'), { recursive: true })
  }

  readHeader(): Promise<VaultHeader | null> {
    return this.readJson<VaultHeader>(this.path('vault.json'))
  }
  async writeHeader(header: VaultHeader): Promise<void> {
    await this.init()
    await this.writeAtomic(this.path('vault.json'), JSON.stringify(header, null, 2) + '\n')
  }

  async listMembers(): Promise<MemberFile[]> {
    const names = await this.list('members', '.json')
    const out: MemberFile[] = []
    for (const n of names) {
      const m = await this.readJson<MemberFile>(this.path('members', n + '.json'))
      if (m) out.push(m)
    }
    return out
  }
  async writeMember(member: MemberFile): Promise<void> {
    if (!/^[0-9a-f]{32}$/.test(member.id)) throw new Error('Invalid member id')
    await this.init()
    await this.writeAtomic(this.path('members', member.id + '.json'), JSON.stringify(member, null, 2) + '\n')
  }
  async deleteMember(id: string): Promise<void> {
    if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('Invalid member id')
    await rm(this.path('members', id + '.json'), { force: true })
  }

  /** Ids of all entry files that have a valid name; other files are ignored. */
  async listEntryIds(): Promise<string[]> {
    return (await this.list('entries', ENTRY_EXT)).filter((n) => ENTRY_ID_PATTERN.test(n))
  }
  async readEntry(id: string): Promise<{ envelope: EntryEnvelope; hash: string } | null> {
    assertEntryId(id)
    try {
      const text = await readFile(this.path('entries', id + ENTRY_EXT), 'utf8')
      return { envelope: JSON.parse(text) as EntryEnvelope, hash: createHash('sha256').update(text).digest('hex') }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }
  /** Returns the content hash of what was written. */
  async writeEntry(id: string, envelope: EntryEnvelope): Promise<string> {
    assertEntryId(id)
    await this.init()
    const text = JSON.stringify(envelope, null, 2) + '\n'
    await this.writeAtomic(this.path('entries', id + ENTRY_EXT), text)
    return createHash('sha256').update(text).digest('hex')
  }
  async deleteEntry(id: string): Promise<void> {
    assertEntryId(id)
    await rm(this.path('entries', id + ENTRY_EXT), { force: true })
  }

  // Attachments: blobs/<uuid>.bin, already encrypted by the caller.
  async listBlobIds(): Promise<string[]> {
    return (await this.list('blobs', BLOB_EXT)).filter((n) => ENTRY_ID_PATTERN.test(n))
  }
  async readBlob(id: string): Promise<Uint8Array | null> {
    assertEntryId(id)
    try {
      return new Uint8Array(await readFile(this.path('blobs', id + BLOB_EXT)))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }
  async writeBlob(id: string, bytes: Uint8Array): Promise<void> {
    assertEntryId(id)
    await this.init()
    const file = this.path('blobs', id + BLOB_EXT)
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, bytes)
    await rename(tmp, file)
  }
  async deleteBlob(id: string): Promise<void> {
    assertEntryId(id)
    await rm(this.path('blobs', id + BLOB_EXT), { force: true })
  }

  private async list(dir: string, ext: string): Promise<string[]> {
    try {
      return (await readdir(this.path(dir))).filter((n) => n.endsWith(ext)).map((n) => n.slice(0, -ext.length)).sort()
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
  }
}
