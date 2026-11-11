import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fastKdfParamsForTests } from './crypto'
import { MemorySecretStore } from './secret-store'
import { GitSync } from './sync/git-sync'
import { localGitServer } from './sync/local-http'
import { VaultService } from './vault-service'

const TOKEN = 'ghp_servicetoken'
const URL = 'http://local/vault.git'
const PW = 'long-enough-pw'
const login = (title: string, password = 'p') =>
  ({ type: 'login', title, tags: [], favorite: false, notes: '', attachments: [], fields: { url: 'u', username: 'x', password } }) as const

let root: string
let server: ReturnType<typeof localGitServer>

async function service(name: string, secrets = new MemorySecretStore()): Promise<VaultService & { secrets: MemorySecretStore }> {
  mkdirSync(join(root, name, 'data'), { recursive: true })
  const s = new VaultService({
    repoDir: join(root, name, 'repo'),
    dataDir: join(root, name, 'data'),
    kdf: await fastKdfParamsForTests(),
    http: server.http,
    secrets,
    allowedRemote: /^http:\/\/local\//
  })
  return Object.assign(s, { secrets })
}

async function unlockFirst(s: VaultService): Promise<string> {
  const st = await s.getState()
  if (st.status !== 'locked') throw new Error('not locked')
  await s.unlock(st.members[0]!.id, PW)
  return st.members[0]!.id
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cv-vs-'))
  execFileSync('git', ['init', '--bare', '-b', 'main', join(root, 'vault.git')], { stdio: 'ignore' })
  server = localGitServer(root, TOKEN)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('connecting a remote', () => {
  it('pushes the vault and remembers the token', async () => {
    const a = await service('a')
    await a.createVault('Anna', PW)
    await unlockFirst(a)
    await a.save(undefined, login('Bank'))
    const st = await a.connectRemote(URL, TOKEN)
    expect(st).toMatchObject({ configured: true, remoteUrl: URL, lastError: null })
    expect(st.lastSyncAt).not.toBeNull()
    expect(await a.secrets.get('github-token')).toBe(TOKEN)
    const log = execFileSync('git', ['-C', join(root, 'vault.git'), 'log', '--format=%an|%ae|%s'], { encoding: 'utf8' })
    expect(log).toContain('@members.churchvault.invalid')
    expect(log).not.toContain('Bank') // titles never appear in history
    const files = execFileSync('git', ['-C', join(root, 'vault.git'), 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' })
    expect(files).toMatch(/vault\.json/)
    expect(files).toMatch(/entries\/.+\.vault/)
    expect(files).toMatch(/members\/.+\.json/)
  })

  it('rejects bad addresses without touching the network', async () => {
    const a = await service('a')
    await a.createVault('Anna', PW)
    await unlockFirst(a)
    const strict = new VaultService({ repoDir: join(root, 'a', 'repo'), dataDir: join(root, 'a', 'data'), kdf: await fastKdfParamsForTests(), http: server.http, secrets: new MemorySecretStore() })
    await unlockFirst(strict)
    for (const bad of ['http://github.com/x/y', 'https://evil.example/x/y', 'https://github.com/x', 'https://github.com/x/y/z', 'git@github.com:x/y.git']) {
      await expect(strict.connectRemote(bad, TOKEN)).rejects.toMatchObject({ code: 'invalid-url' })
    }
    expect(server.log).toEqual([])
    strict.lock()
  })

  it('forgets the remote and token again after a bad token', async () => {
    const a = await service('a')
    await a.createVault('Anna', PW)
    await unlockFirst(a)
    await expect(a.connectRemote(URL, 'wrong')).rejects.toMatchObject({ code: 'auth' })
    expect(a.getSyncStatus()).toMatchObject({ configured: false, remoteUrl: null })
    expect(await a.secrets.get('github-token')).toBeNull()
    // Still works offline
    await a.save(undefined, login('Still works'))
    expect(a.list({})).toHaveLength(1)
  })

  it('can be disconnected', async () => {
    const a = await service('a')
    await a.createVault('Anna', PW)
    await unlockFirst(a)
    await a.connectRemote(URL, TOKEN)
    expect(await a.disconnectRemote()).toMatchObject({ configured: false })
    expect(await a.secrets.get('github-token')).toBeNull()
    await expect(a.syncNow()).rejects.toMatchObject({ code: 'no-remote' })
  })

  it('reports an error in the status when sync fails later, then recovers', async () => {
    const a = await service('a')
    await a.createVault('Anna', PW)
    await unlockFirst(a)
    await a.connectRemote(URL, TOKEN)
    await a.secrets.set('github-token', 'revoked')
    expect((await a.syncNow()).lastError).toMatchObject({ code: 'auth' })
    await a.secrets.set('github-token', TOKEN)
    expect((await a.syncNow()).lastError).toBeNull()
  })
})

describe('two computers of the same person', () => {
  async function pair() {
    const a = await service('a')
    await a.createVault('Anna', PW)
    const memberId = await unlockFirst(a)
    const e = await a.save(undefined, login('Bank', 'v1'))
    await a.connectRemote(URL, TOKEN)

    // Second computer: clone the repo, same member.
    const secrets = new MemorySecretStore()
    await secrets.set('github-token', TOKEN)
    const b = await service('b', secrets)
    await new GitSync({ dir: join(root, 'b', 'repo'), http: server.http, getToken: async () => TOKEN, author: () => ({ name: 'b', email: 'b@x.invalid' }) }).clone(URL)
    await b.unlock(memberId, PW)
    return { a, b, e }
  }

  it('shares entries in both directions', async () => {
    const { a, b, e } = await pair()
    expect(b.get(e.id)?.title).toBe('Bank')
    expect(b.getSyncStatus().configured).toBe(true) // remote read from the cloned repo
    const n = await b.save(undefined, login('From B'))
    await b.syncNow()
    expect((await a.syncNow()).lastError).toBeNull()
    expect(a.get(n.id)?.title).toBe('From B')
    // deletion travels too
    await a.delete(e.id)
    await a.syncNow()
    await b.syncNow()
    expect(b.get(e.id)).toBeNull()
  })

  it('keeps both versions of an entry edited on both sides, and can resolve it', async () => {
    const { a, b, e } = await pair()
    await a.save(e.id, login('Bank', 'from-A'))
    await b.save(e.id, login('Bank', 'from-B'))
    await a.syncNow()
    expect((await b.syncNow()).lastError).toBeNull()

    // A's edit won the original; B's edit survives as a flagged copy.
    expect((b.get(e.id)?.fields as { password: string }).password).toBe('from-A')
    const copy = b.list({}).find((r) => r.conflictOf)
    expect(copy).toMatchObject({ conflictOf: e.id, title: 'Bank' })
    expect((b.get(copy!.id)?.fields as { password: string }).password).toBe('from-B')

    // The copy reaches A as well.
    await a.syncNow()
    expect(a.list({}).filter((r) => r.conflictOf)).toHaveLength(1)

    // Resolve on B by keeping the copy: original takes B's content, the copy disappears.
    await b.resolveConflict(copy!.id, true)
    expect((b.get(e.id)?.fields as { password: string }).password).toBe('from-B')
    expect(b.list({}).some((r) => r.conflictOf)).toBe(false)
    expect((b.get(e.id) as { conflictOf?: string }).conflictOf).toBeUndefined()
    await b.syncNow()
    await a.syncNow()
    expect((a.get(e.id)?.fields as { password: string }).password).toBe('from-B')
    expect(a.list({}).some((r) => r.conflictOf)).toBe(false)
  })

  it('can discard the copy instead', async () => {
    const { a, b, e } = await pair()
    await a.save(e.id, login('Bank', 'from-A'))
    await b.save(e.id, login('Bank', 'from-B'))
    await a.syncNow()
    await b.syncNow()
    const copy = b.list({}).find((r) => r.conflictOf)!
    await b.resolveConflict(copy.id, false)
    expect((b.get(e.id)?.fields as { password: string }).password).toBe('from-A')
    expect(b.list({})).toHaveLength(1)
    await expect(b.resolveConflict(e.id, true)).rejects.toMatchObject({ code: 'invalid' }) // not a copy
  })

  it('shares one sync run between concurrent callers', async () => {
    const { a } = await pair()
    const [x, y] = await Promise.all([a.syncNow(), a.syncNow()])
    expect(x).toEqual(y)
  })
})
