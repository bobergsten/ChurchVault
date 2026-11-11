import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitSync, SyncError } from './git-sync'
import { localGitServer } from './local-http'

const TOKEN = 'ghp_testtoken'
const URL = 'http://local/vault.git'
const E1 = '11111111-1111-4111-8111-111111111111'
const E2 = '22222222-2222-4222-8222-222222222222'
const E3 = '33333333-3333-4333-8333-333333333333'

let root: string
let server: ReturnType<typeof localGitServer>

function envelope(text: string): string {
  return JSON.stringify({ format: 1, generation: 1, nonce: 'n', ct: text })
}
function write(dir: string, path: string, content: string): void {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), content)
}
const read = (dir: string, path: string): string => readFileSync(join(dir, path), 'utf8')

function client(name: string, token = TOKEN, srv = server): { dir: string; sync: GitSync } {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  return {
    dir,
    sync: new GitSync({ dir, http: srv.http, getToken: async () => token, author: () => ({ name, email: `${name}@churchvault.invalid` }) })
  }
}

async function started(name: string): Promise<{ dir: string; sync: GitSync }> {
  const c = client(name)
  await c.sync.init()
  await c.sync.setRemote(URL)
  return c
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cv-git-'))
  execFileSync('git', ['init', '--bare', '-b', 'main', join(root, 'vault.git')], { stdio: 'ignore' })
  server = localGitServer(root, TOKEN)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** A has pushed an initial vault with E1; B has cloned it. */
async function twoClients() {
  const a = await started('anna')
  write(a.dir, 'vault.json', '{"v":1}')
  write(a.dir, `entries/${E1}.vault`, envelope('one'))
  expect((await a.sync.sync()).pushed).toBe(true)
  const b = client('bo')
  await b.sync.clone(URL)
  return { a, b }
}

describe('basic sync', () => {
  it('pushes a new vault and a second computer can clone it', async () => {
    const { b } = await twoClients()
    expect(read(b.dir, `entries/${E1}.vault`)).toBe(envelope('one'))
    expect(read(b.dir, 'vault.json')).toBe('{"v":1}')
  })

  it('does nothing when already in sync', async () => {
    const { a } = await twoClients()
    expect(await a.sync.sync()).toMatchObject({ pulled: false, pushed: false, conflicts: [] })
  })

  it('fast-forwards new remote commits, including deletions', async () => {
    const { a, b } = await twoClients()
    write(a.dir, `entries/${E2}.vault`, envelope('two'))
    rmSync(join(a.dir, `entries/${E1}.vault`))
    await a.sync.sync()
    const r = await b.sync.sync()
    expect(r).toMatchObject({ pulled: true, pushed: false })
    expect(read(b.dir, `entries/${E2}.vault`)).toBe(envelope('two'))
    expect(existsSync(join(b.dir, `entries/${E1}.vault`))).toBe(false)
  })

  it('merges edits to different entries from two computers', async () => {
    const { a, b } = await twoClients()
    write(a.dir, `entries/${E2}.vault`, envelope('from anna'))
    write(b.dir, `entries/${E3}.vault`, envelope('from bo'))
    await a.sync.sync()
    const r = await b.sync.sync()
    expect(r).toMatchObject({ pulled: true, pushed: true, conflicts: [] })
    await a.sync.sync()
    for (const c of [a, b]) {
      expect(read(c.dir, `entries/${E2}.vault`)).toBe(envelope('from anna'))
      expect(read(c.dir, `entries/${E3}.vault`)).toBe(envelope('from bo'))
    }
  })
})

describe('conflicts', () => {
  it('keeps the remote version and reports ours when the same entry changed on both sides', async () => {
    const { a, b } = await twoClients()
    write(a.dir, `entries/${E1}.vault`, envelope('anna edit'))
    write(b.dir, `entries/${E1}.vault`, envelope('bo edit'))
    await a.sync.sync()
    const r = await b.sync.sync()
    expect(r.conflicts).toEqual([{ id: E1, ours: JSON.parse(envelope('bo edit')) }])
    expect(read(b.dir, `entries/${E1}.vault`)).toBe(envelope('anna edit'))
    await a.sync.sync()
    expect(read(a.dir, `entries/${E1}.vault`)).toBe(envelope('anna edit'))
  })

  it('lets the caller add files after a merge, and pushes them', async () => {
    const { a, b } = await twoClients()
    write(a.dir, `entries/${E1}.vault`, envelope('anna edit'))
    write(b.dir, `entries/${E1}.vault`, envelope('bo edit'))
    await a.sync.sync()
    await b.sync.sync({
      onMerged: async (r) => write(b.dir, `entries/${E2}.vault`, envelope(`copy of ${r.conflicts[0]!.id}`))
    })
    await a.sync.sync()
    expect(read(a.dir, `entries/${E2}.vault`)).toBe(envelope(`copy of ${E1}`))
  })

  it('keeps a local edit when the remote deleted the entry', async () => {
    const { a, b } = await twoClients()
    rmSync(join(a.dir, `entries/${E1}.vault`))
    write(b.dir, `entries/${E1}.vault`, envelope('bo edit'))
    await a.sync.sync()
    const r = await b.sync.sync()
    expect(r.conflicts).toEqual([])
    expect(read(b.dir, `entries/${E1}.vault`)).toBe(envelope('bo edit'))
    await a.sync.sync()
    expect(read(a.dir, `entries/${E1}.vault`)).toBe(envelope('bo edit'))
  })

  it('lets a remote edit win over a local delete', async () => {
    const { a, b } = await twoClients()
    write(a.dir, `entries/${E1}.vault`, envelope('anna edit'))
    rmSync(join(b.dir, `entries/${E1}.vault`))
    await a.sync.sync()
    await b.sync.sync()
    expect(read(b.dir, `entries/${E1}.vault`)).toBe(envelope('anna edit'))
  })

  it('reports member files edited on both sides', async () => {
    const { a, b } = await twoClients()
    const m = 'members/' + 'a'.repeat(32) + '.json'
    write(a.dir, m, '{"n":0}')
    await a.sync.sync()
    await b.sync.sync()
    write(a.dir, m, '{"n":1}')
    write(b.dir, m, '{"n":2}')
    await a.sync.sync()
    const r = await b.sync.sync()
    expect(r.memberConflicts).toEqual([m])
    expect(read(b.dir, m)).toBe('{"n":1}')
  })

  it('refuses to guess when vault.json changed on both sides', async () => {
    const { a, b } = await twoClients()
    write(a.dir, 'vault.json', '{"v":2}')
    write(b.dir, 'vault.json', '{"v":3}')
    await a.sync.sync()
    await expect(b.sync.sync()).rejects.toMatchObject({ code: 'header-conflict' })
  })

  it('retries when someone pushes between our fetch and push', async () => {
    const { a, b } = await twoClients()
    write(b.dir, `entries/${E3}.vault`, envelope('from bo'))
    const racing = localGitServer(root, TOKEN, async () => {
      write(a.dir, `entries/${E2}.vault`, envelope('from anna'))
      await a.sync.sync()
    })
    const b2 = new GitSync({ dir: b.dir, http: racing.http, getToken: async () => TOKEN, author: () => ({ name: 'bo', email: 'b@x.invalid' }) })
    const r = await b2.sync()
    expect(r).toMatchObject({ pushed: true, pulled: true })
    await a.sync.sync()
    expect(read(a.dir, `entries/${E3}.vault`)).toBe(envelope('from bo'))
    expect(read(b.dir, `entries/${E2}.vault`)).toBe(envelope('from anna'))
  })
})

describe('errors', () => {
  it('reports a bad token as an auth error', async () => {
    const c = client('eve', 'wrong-token')
    await c.sync.init()
    await c.sync.setRemote(URL)
    write(c.dir, 'vault.json', '{}')
    await expect(c.sync.sync()).rejects.toMatchObject({ code: 'auth' })
    await expect(client('eve2', 'x').sync.clone(URL)).rejects.toBeInstanceOf(SyncError)
  })

  it('reports a missing token', async () => {
    const c = new GitSync({ dir: join(root, 'x'), http: server.http, getToken: async () => null, author: () => ({ name: 'x', email: 'x@x.invalid' }) })
    await c.init()
    await c.setRemote(URL)
    await expect(c.sync()).rejects.toMatchObject({ code: 'auth' })
  })

  it('needs a remote', async () => {
    const c = client('solo')
    await c.sync.init()
    await expect(c.sync.sync()).rejects.toMatchObject({ code: 'no-remote' })
  })

  it('refuses to merge a different vault into this one', async () => {
    const { a } = await twoClients()
    void a
    const other = await started('other')
    write(other.dir, 'vault.json', '{"v":99}')
    await expect(other.sync.sync()).rejects.toMatchObject({ code: 'unrelated-history' })
  })

  it('does not commit temp files', async () => {
    const a = await started('anna')
    write(a.dir, 'vault.json', '{}')
    write(a.dir, `entries/${E1}.vault.123.tmp`, 'partial')
    await a.sync.sync()
    const b = client('bo')
    await b.sync.clone(URL)
    expect(existsSync(join(b.dir, `entries/${E1}.vault.123.tmp`))).toBe(false)
  })
})
