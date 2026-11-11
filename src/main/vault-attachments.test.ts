import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_ATTACHMENT_BYTES, type AttachmentRef } from '@shared/entry'
import type { VaultState } from '@shared/api'
import { fastKdfParamsForTests } from './crypto'
import { MemorySecretStore } from './secret-store'
import { GitSync } from './sync/git-sync'
import { localGitServer } from './sync/local-http'
import { VaultService } from './vault-service'

const TOKEN = 'ghp_attach'
const URL = 'http://local/vault.git'
const PW = 'long-enough-pw'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const doc = (attachments: AttachmentRef[], title = 'Deed') =>
  ({ type: 'document', title, tags: [], favorite: false, notes: '', attachments, fields: {} }) as const

/** Every service a test creates; locked before the temp folder is deleted (Windows cannot delete open files). */
const opened: VaultService[] = []
function track(s: VaultService): VaultService {
  opened.push(s)
  return s
}
let root: string
let server: ReturnType<typeof localGitServer>

async function service(name: string, secrets = new MemorySecretStore()) {
  mkdirSync(join(root, name, 'data'), { recursive: true })
  return track(new VaultService({
    repoDir: join(root, name, 'repo'),
    dataDir: join(root, name, 'data'),
    kdf: await fastKdfParamsForTests(),
    http: server.http,
    secrets,
    allowedRemote: /^http:\/\/local\//
  }))
}

async function unlocked(name = 'a') {
  const s = await service(name)
  await s.createVault('Anna', PW)
  const st = (await s.getState()) as Extract<VaultState, { status: 'locked' }>
  await s.unlock(st.members[0]!.id, PW)
  return { s, memberId: st.members[0]!.id }
}

const blobFiles = (name: string): string[] => {
  const dir = join(root, name, 'repo', 'blobs')
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.bin')) : []
}
const text = (d: Uint8Array): string => new TextDecoder().decode(d)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cv-att-'))
  execFileSync('git', ['init', '--bare', '-b', 'main', join(root, 'vault.git')], { stdio: 'ignore' })
  server = localGitServer(root, TOKEN)
})
afterEach(() => {
  for (const s of opened.splice(0)) s.lock()
  rmSync(root, { recursive: true, force: true, maxRetries: 5 })
})

describe('attachments', () => {
  it('stores files encrypted and reads them back', async () => {
    const { s } = await unlocked()
    const file = join(root, 'Church deed.txt')
    writeFileSync(file, 'Property of the parish since 1874')
    const ref = await s.addAttachmentFromPath(file)
    expect(ref).toMatchObject({ name: 'Church deed.txt', size: 33, mime: 'text/plain' })
    expect(blobFiles('a')).toEqual([]) // nothing in the repo until the entry is saved

    const e = await s.save(undefined, doc([ref]))
    expect(blobFiles('a')).toEqual([`${ref.id}.bin`])
    const raw = readFileSync(join(root, 'a', 'repo', 'blobs', `${ref.id}.bin`))
    expect(raw.includes(Buffer.from('parish'))).toBe(false)
    expect(text((await s.readAttachment(ref.id)).data)).toBe('Property of the parish since 1874')
    expect(await s.previewAttachment(ref.id)).toEqual({ kind: 'text', text: 'Property of the parish since 1874' })
    expect(s.list({ query: 'deed' }).map((r) => r.id)).toEqual([e.id]) // attachment names are searchable

    // committed to git
    const files = execFileSync('git', ['-C', join(root, 'a', 'repo'), 'ls-files'], { encoding: 'utf8' })
    expect(files).toContain(`blobs/${ref.id}.bin`)
  })

  it('previews images inline but not SVG or PDF', async () => {
    const { s } = await unlocked()
    const png = await s.addAttachment('photo.png', PNG)
    expect(await s.previewAttachment(png.id)).toEqual({ kind: 'image', dataUrl: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}` })
    const svg = await s.addAttachment('x.svg', new TextEncoder().encode('<svg onload="alert(1)"/>'))
    expect(await s.previewAttachment(svg.id)).toEqual({ kind: 'none' })
    const pdf = await s.addAttachment('a.pdf', new Uint8Array([37, 80, 68, 70]))
    expect(pdf.mime).toBe('application/pdf')
    expect(await s.previewAttachment(pdf.id)).toEqual({ kind: 'none' })
  })

  it('rejects files over the size limit', async () => {
    const { s } = await unlocked()
    await expect(s.addAttachment('big.bin', new Uint8Array(MAX_ATTACHMENT_BYTES + 1))).rejects.toMatchObject({ code: 'too-large' })
    const big = join(root, 'big.bin')
    writeFileSync(big, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))
    await expect(s.addAttachmentFromPath(big)).rejects.toMatchObject({ code: 'too-large' })
    await expect(s.addAttachmentFromPath(root)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('trusts only stored metadata and known ids', async () => {
    const { s } = await unlocked()
    const ref = await s.addAttachment('a.txt', new TextEncoder().encode('hello'))
    const e = await s.save(undefined, doc([{ ...ref, name: 'renamed.txt', size: 999, mime: 'text/html' }]))
    expect(e.attachments).toEqual([{ ...ref, name: 'renamed.txt' }])
    const fake = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'x', size: 1, mime: 'text/plain' }
    await expect(s.save(undefined, doc([fake]))).rejects.toMatchObject({ code: 'invalid' })
    // an attachment of one entry cannot be claimed by another
    await expect(s.save(undefined, doc([ref], 'Thief'))).rejects.toMatchObject({ code: 'invalid' })
    await expect(s.readAttachment(fake.id)).rejects.toMatchObject({ code: 'not-found' })
  })

  it('forgets unsaved attachments when the vault locks', async () => {
    const { s, memberId } = await unlocked()
    const ref = await s.addAttachment('a.txt', new TextEncoder().encode('draft'))
    s.lock()
    await s.unlock(memberId, PW)
    await expect(s.readAttachment(ref.id)).rejects.toMatchObject({ code: 'not-found' })
    await expect(s.save(undefined, doc([ref]))).rejects.toMatchObject({ code: 'invalid' })
  })

  it('deletes blob files when attachments or entries are removed', async () => {
    const { s } = await unlocked()
    const r1 = await s.addAttachment('1.txt', new TextEncoder().encode('one'))
    const r2 = await s.addAttachment('2.txt', new TextEncoder().encode('two'))
    const e = await s.save(undefined, doc([r1, r2]))
    expect(blobFiles('a').sort()).toEqual([`${r1.id}.bin`, `${r2.id}.bin`].sort())
    await s.save(e.id, doc([r2]))
    expect(blobFiles('a')).toEqual([`${r2.id}.bin`])
    await s.delete(e.id)
    expect(blobFiles('a')).toEqual([])
  })
})

describe('attachments across computers', () => {
  async function pair() {
    const { s: a, memberId } = await unlocked('a')
    await a.connectRemote(URL, TOKEN)
    const secrets = new MemorySecretStore()
    await secrets.set('github-token', TOKEN)
    const b = await service('b', secrets)
    await new GitSync({ dir: join(root, 'b', 'repo'), http: server.http, getToken: async () => TOKEN, author: () => ({ name: 'b', email: 'b@x.invalid' }) }).clone(URL)
    await b.unlock(memberId, PW)
    return { a, b, memberId }
  }

  it('syncs attachments to another computer', async () => {
    const { a, b } = await pair()
    const ref = await a.addAttachment('minutes.txt', new TextEncoder().encode('Board minutes'))
    await a.save(undefined, doc([ref]))
    await a.syncNow()
    await b.syncNow()
    expect(text((await b.readAttachment(ref.id)).data)).toBe('Board minutes')
  })

  it('keeps a shared blob when one side of an edit conflict is discarded', async () => {
    const { a, b } = await pair()
    const ref = await a.addAttachment('plan.txt', new TextEncoder().encode('Floor plan'))
    const e = await a.save(undefined, doc([ref]))
    await a.syncNow()
    await b.syncNow()
    await a.save(e.id, doc([ref], 'Deed A'))
    await b.save(e.id, doc([ref], 'Deed B'))
    await a.syncNow()
    await b.syncNow()
    const copy = b.list({}).find((r) => r.conflictOf)!
    await b.resolveConflict(copy.id, false)
    expect(text((await b.readAttachment(ref.id)).data)).toBe('Floor plan')
    expect(blobFiles('b')).toEqual([`${ref.id}.bin`])
  })
})

describe('key rotation with attachments', () => {
  it('re-encrypts attachments and drops orphans', async () => {
    const { s: a } = await unlocked('a')
    await a.connectRemote(URL, TOKEN)
    const ref = await a.addAttachment('budget.txt', new TextEncoder().encode('Budget 2026'))
    await a.save(undefined, doc([ref]))
    const before = readFileSync(join(root, 'a', 'repo', 'blobs', `${ref.id}.bin`))
    // an orphan blob (e.g. left by an old bug) must not block rotation
    const orphan = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    writeFileSync(join(root, 'a', 'repo', 'blobs', `${orphan}.bin`), 'junk')

    const b = await service('b')
    await b.joinVault({ url: URL, token: TOKEN, name: 'Bo', password: 'bo-long-password' })
    await a.syncNow()
    const bo = (await a.listMembers()).find((m) => m.pending)!
    await a.approveMember(bo.id)
    await a.removeMember(bo.id)

    const after = readFileSync(join(root, 'a', 'repo', 'blobs', `${ref.id}.bin`))
    expect(after.equals(before)).toBe(false)
    expect(after.readUInt32BE(4)).toBe(2) // key generation 2
    expect(text((await a.readAttachment(ref.id)).data)).toBe('Budget 2026')
    expect(blobFiles('a')).toEqual([`${ref.id}.bin`])
    expect(readdirSync(join(root, 'a', 'data'))).not.toContain('rotation') // scratch cleaned up
  })
})
