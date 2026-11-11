import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EntryInput } from '@shared/entry'
import { createVault, fastKdfParamsForTests, rotateVaultKey, type VaultSession } from '../crypto'
import { EntryRepository, FileStore, IndexDb } from './index'

let dir: string
let session: VaultSession
let memberId: string
let files: FileStore
let index: IndexDb
let repo: EntryRepository

const login = (over: Partial<EntryInput> = {}): EntryInput =>
  ({
    type: 'login',
    title: 'Church bank',
    tags: ['finance'],
    favorite: false,
    notes: 'treasurer account',
    attachments: [],
    fields: { url: 'https://bank.example', username: 'treasurer', password: 'S3cretPassw0rd!' },
    ...over
  }) as EntryInput

async function open(): Promise<IndexDb> {
  return IndexDb.open(join(dir, 'index.db'), await session.sqliteKey())
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cv-'))
  const v = await createVault({ adminName: 'Anna', password: 'pw', kdf: await fastKdfParamsForTests() })
  session = v.session
  memberId = v.member.id
  files = new FileStore(join(dir, 'repo'))
  await files.init()
  index = await open()
  repo = new EntryRepository(session, files, index, memberId)
})

afterEach(async () => {
  index.close()
  await rm(dir, { recursive: true, force: true })
})

describe('EntryRepository', () => {
  it('creates, reads, updates and deletes entries', async () => {
    const e = await repo.create(login())
    expect(e.rev).toBe(1)
    expect(e.updatedBy).toBe(memberId)
    expect(repo.get(e.id)).toEqual(e)

    const u = await repo.update(e.id, login({ title: 'Bank' }))
    expect(u.rev).toBe(2)
    expect(u.createdAt).toBe(e.createdAt)
    expect(repo.get(e.id)?.title).toBe('Bank')

    await repo.delete(e.id)
    expect(repo.get(e.id)).toBeNull()
    expect(await files.listEntryIds()).toEqual([])
  })

  it('refuses to change an entry type or update a missing entry', async () => {
    const e = await repo.create(login())
    await expect(repo.update(e.id, { type: 'note', title: 'x', tags: [], favorite: false, notes: '', attachments: [], fields: {} })).rejects.toThrow(/type/)
    await expect(repo.update('00000000-0000-4000-8000-000000000000', login())).rejects.toThrow(/No such entry/)
  })

  it('writes only ciphertext to the repo files', async () => {
    const e = await repo.create(login())
    const text = await readFile(join(files.root, 'entries', e.id + '.vault'), 'utf8')
    for (const secret of ['S3cretPassw0rd', 'bank.example', 'Church bank', 'treasurer']) {
      expect(text).not.toContain(secret)
    }
  })

  it('stores the local index encrypted', async () => {
    await repo.create(login())
    index.close()
    const raw = await readFile(join(dir, 'index.db'))
    expect(raw.includes('Church bank')).toBe(false)
    expect(raw.subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3')
    index = await open() // reopen so afterEach can close
  })

  it('refuses to open the index with the wrong key', async () => {
    await repo.create(login())
    index.close()
    expect(() => IndexDb.open(join(dir, 'index.db'), new Uint8Array(32).fill(7))).toThrow()
    index = await open()
  })

  it('lists with filters and favourites first', async () => {
    await repo.create(login({ title: 'Zeta' }))
    await repo.create(login({ title: 'alpha' }))
    await repo.create({ type: 'doorcode', title: 'Church side door', tags: ['building'], favorite: true, notes: '', attachments: [], fields: { location: 'North', code: '4711#' } })
    expect(repo.list().map((r) => r.title)).toEqual(['Church side door', 'alpha', 'Zeta'])
    expect(repo.list({ type: 'login' }).map((r) => r.title)).toEqual(['alpha', 'Zeta'])
  })
})

describe('search', () => {
  it('finds by title, tags, notes and non-secret fields, with prefixes and accents', async () => {
    await repo.create(login())
    await repo.create({ type: 'note', title: 'Wi-Fi', tags: [], favorite: false, notes: 'Café router in the basement', attachments: [], fields: {} })
    expect(repo.list({ query: 'bank' })).toHaveLength(1)
    expect(repo.list({ query: 'fina' })).toHaveLength(1) // tag prefix
    expect(repo.list({ query: 'TREASURER' })).toHaveLength(1) // notes + username, case-insensitive
    expect(repo.list({ query: 'bank.example' })).toHaveLength(1) // url
    expect(repo.list({ query: 'cafe basement' })).toHaveLength(1) // accent folding, AND semantics
    expect(repo.list({ query: 'nothing here' })).toHaveLength(0)
  })

  it('never indexes secret values', async () => {
    await repo.create(login())
    await repo.create({ type: 'card', title: 'Visa', tags: [], favorite: false, notes: '', attachments: [], fields: { holder: 'Zacharias', number: '4111111111111111', expiry: '12/30', cvv: '987' } })
    expect(repo.list({ query: 'S3cretPassw0rd' })).toHaveLength(0)
    expect(repo.list({ query: '4111111111111111' })).toHaveLength(0)
    expect(repo.list({ query: '987' })).toHaveLength(0)
    expect(repo.list({ query: 'Zacharias' })).toHaveLength(1) // card holder is searchable
  })

  it('is safe against FTS syntax in user input', async () => {
    await repo.create(login())
    for (const q of ['"', 'bank OR', 'NEAR(', '*', '(', 'title:bank', "' DROP TABLE entries; --"]) {
      expect(() => repo.list({ query: q })).not.toThrow()
    }
  })
})

describe('rebuild', () => {
  it('recreates the index on a fresh machine from the files alone', async () => {
    const a = await repo.create(login())
    const b = await repo.create(login({ title: 'Other' }))

    const fresh = IndexDb.open(join(dir, 'fresh.db'), await session.sqliteKey())
    const report = await new EntryRepository(session, files, fresh, memberId).rebuild()
    expect(report.added.sort()).toEqual([a.id, b.id].sort())
    expect(report.failed).toEqual([])
    expect(fresh.get(a.id)).toEqual(a)
    expect(fresh.list({ query: 'other' })).toHaveLength(1)
    fresh.close()
  })

  it('applies external changes (as after a git pull) and skips unchanged files', async () => {
    const a = await repo.create(login())
    const b = await repo.create(login({ title: 'Gone' }))

    // Simulate a pull: a is edited elsewhere, b is deleted, c is new.
    const other = IndexDb.open(join(dir, 'other.db'), await session.sqliteKey())
    const elsewhere = new EntryRepository(session, files, other, 'someone-else')
    await elsewhere.rebuild()
    await elsewhere.update(a.id, login({ title: 'Edited elsewhere' }))
    await elsewhere.delete(b.id)
    const c = await elsewhere.create(login({ title: 'New one' }))
    other.close()

    const report = await repo.rebuild()
    expect(report).toMatchObject({ added: [c.id], updated: [a.id], removed: [b.id], unchanged: 0, failed: [] })
    expect(repo.get(a.id)?.title).toBe('Edited elsewhere')
    expect(repo.get(b.id)).toBeNull()
    expect((await repo.rebuild()).unchanged).toBe(2)
  })

  it('reports undecryptable and tampered files without aborting', async () => {
    const good = await repo.create(login())
    const bad = await repo.create(login({ title: 'Bad' }))
    const p = join(files.root, 'entries', bad.id + '.vault')
    const env = JSON.parse(await readFile(p, 'utf8'))
    env.ct = env.ct.slice(0, -4) + 'AAAA'
    await writeFile(p, JSON.stringify(env))
    // a file copied under another entry's name must also be rejected
    const stolen = '11111111-1111-4111-8111-111111111111'
    await writeFile(join(files.root, 'entries', stolen + '.vault'), await readFile(join(files.root, 'entries', good.id + '.vault')))
    index.clear()

    const report = await repo.rebuild()
    expect(report.added).toEqual([good.id])
    expect(report.failed.map((f) => f.id).sort()).toEqual([bad.id, stolen].sort())
    expect(report.failed.every((f) => f.code === 'tampered')).toBe(true)
  })

  it('reports entries from an older key generation instead of crashing', async () => {
    const e = await repo.create(login())
    const rot = await rotateVaultKey(session, { format: 1, vaultId: session.vaultId, createdAt: '', generation: 1, recovery: { nonce: '', ct: '' } }, [])
    index.clear()
    const r2 = new EntryRepository(rot.session, files, index, memberId)
    const report = await r2.rebuild()
    expect(report.failed).toEqual([{ id: e.id, code: 'stale-generation' }])
  })
})

describe('FileStore', () => {
  it('rejects path-traversal ids and ignores foreign files', async () => {
    await expect(files.readEntry('../../etc/passwd')).rejects.toThrow(/Invalid entry id/)
    await expect(files.writeEntry('../x', { format: 1, generation: 1, nonce: '', ct: '' })).rejects.toThrow()
    await expect(files.deleteEntry('..')).rejects.toThrow()
    await writeFile(join(files.root, 'entries', 'README.vault'), 'x')
    await writeFile(join(files.root, 'entries', '.DS_Store'), 'x')
    expect(await files.listEntryIds()).toEqual([])
  })

  it('stores header and member files', async () => {
    const v = await createVault({ adminName: 'Anna', password: 'pw', kdf: await fastKdfParamsForTests() })
    await files.writeHeader(v.header)
    await files.writeMember(v.member)
    expect(await files.readHeader()).toEqual(v.header)
    expect(await files.listMembers()).toEqual([v.member])
    await files.deleteMember(v.member.id)
    expect(await files.listMembers()).toEqual([])
    expect(await new FileStore(join(dir, 'empty')).readHeader()).toBeNull()
  })
})
