import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VaultState } from '@shared/api'
import { fastKdfParamsForTests } from './crypto'
import { MemorySecretStore } from './secret-store'
import { localGitServer } from './sync/local-http'
import { VaultService } from './vault-service'

const TOKEN = 'ghp_memberstest'
const URL = 'http://local/vault.git'
const PW = 'anna-long-password'
const login = (title: string, password = 'p') =>
  ({ type: 'login', title, tags: [], favorite: false, notes: '', attachments: [], fields: { url: 'u', username: 'x', password } }) as const

/** Every service a test creates; locked before the temp folder is deleted (Windows cannot delete open files). */
const opened: VaultService[] = []
function track(s: VaultService): VaultService {
  opened.push(s)
  return s
}
let root: string
let server: ReturnType<typeof localGitServer>

async function service(name: string): Promise<VaultService & { secrets: MemorySecretStore }> {
  mkdirSync(join(root, name, 'data'), { recursive: true })
  const secrets = new MemorySecretStore()
  const s = track(new VaultService({
    repoDir: join(root, name, 'repo'),
    dataDir: join(root, name, 'data'),
    kdf: await fastKdfParamsForTests(),
    http: server.http,
    secrets,
    allowedRemote: /^http:\/\/local\//
  }))
  return Object.assign(s, { secrets })
}

async function unlockByName(s: VaultService, name: string, pw: string): Promise<void> {
  const st = await s.getState()
  if (st.status !== 'locked') throw new Error(`state is ${st.status}`)
  const m = st.members.find((x) => x.name === name)
  if (!m) throw new Error(`no member ${name} in ${JSON.stringify(st.members)}`)
  await s.unlock(m.id, pw)
}

async function anna() {
  const a = await service('a')
  const { recoveryKey } = await a.createVault('Anna', PW)
  await unlockByName(a, 'Anna', PW)
  const e = await a.save(undefined, login('Bank'))
  await a.connectRemote(URL, TOKEN)
  return { a, recoveryKey, e }
}

async function bo(a: VaultService) {
  const b = await service('b')
  const { fingerprint } = await b.joinVault({ url: URL, token: TOKEN, name: 'Bo', password: 'bo-long-password' })
  await a.syncNow()
  const pending = (await a.listMembers()).find((m) => m.pending)!
  return { b, fingerprint, pending }
}

const pw = (e: { fields: unknown } | null): string => (e!.fields as { password: string }).password

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cv-mem-'))
  execFileSync('git', ['init', '--bare', '-b', 'main', join(root, 'vault.git')], { stdio: 'ignore' })
  server = localGitServer(root, TOKEN)
})
afterEach(() => {
  for (const s of opened.splice(0)) s.lock()
  rmSync(root, { recursive: true, force: true, maxRetries: 5 })
})

describe('joining', () => {
  it('lets a new person request access, an admin approve, and the new person read the vault', async () => {
    const { a, e } = await anna()
    const { b, fingerprint, pending } = await bo(a)

    expect(await b.getState()).toMatchObject({ status: 'pending', member: { name: 'Bo' }, fingerprint })
    expect(pending).toMatchObject({ name: 'Bo', pending: true, fingerprint }) // both sides see the same code
    await expect(b.unlock(pending.id, 'bo-long-password')).rejects.toMatchObject({ code: 'pending-member' })
    expect((await b.checkApproval()).status).toBe('pending')

    await a.approveMember(pending.id)
    await a.syncNow()
    const after = (await b.checkApproval()) as Extract<VaultState, { status: 'locked' }>
    expect(after.status).toBe('locked')
    expect(after.members.map((m) => m.name).sort()).toEqual(['Anna', 'Bo'])

    await unlockByName(b, 'Bo', 'bo-long-password')
    expect(b.get(e.id)?.title).toBe('Bank')
    const n = await b.save(undefined, login('From Bo'))
    await b.syncNow()
    await a.syncNow()
    expect(a.get(n.id)?.title).toBe('From Bo')
    expect((await a.listMembers()).every((m) => !m.pending)).toBe(true)
  })

  it('survives restarting the waiting computer', async () => {
    const { a } = await anna()
    const { fingerprint } = await bo(a)
    const b2 = await service('b') // same folders, new process
    expect(await b2.getState()).toMatchObject({ status: 'pending', fingerprint })
  })

  it('validates input and cleans up after failures', async () => {
    await anna()
    const b = await service('b')
    const ok = { url: URL, token: TOKEN, name: 'Bo', password: 'bo-long-password' }
    await expect(b.joinVault({ ...ok, url: 'https://evil.example/x/y' })).rejects.toMatchObject({ code: 'invalid-url' })
    await expect(b.joinVault({ ...ok, name: ' ' })).rejects.toMatchObject({ code: 'name-required' })
    await expect(b.joinVault({ ...ok, password: 'short' })).rejects.toMatchObject({ code: 'weak-password' })
    await expect(b.joinVault({ ...ok, token: 'wrong' })).rejects.toMatchObject({ code: 'auth' })
    expect(await b.secrets.get('github-token')).toBeNull()
    expect(await b.getState()).toEqual({ status: 'no-vault' })
    await b.joinVault(ok) // a retry works
    await expect(b.joinVault(ok)).rejects.toMatchObject({ code: 'exists' })
  })

  it('refuses a repository that is not a vault', async () => {
    const other = join(root, 'empty.git')
    execFileSync('git', ['init', '--bare', '-b', 'main', other], { stdio: 'ignore' })
    const work = join(root, 'w')
    execFileSync('git', ['clone', '-q', other, work], { stdio: 'ignore' })
    execFileSync('git', ['-C', work, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '--allow-empty', '-m', 'x'])
    execFileSync('git', ['-C', work, 'push', '-q', 'origin', 'HEAD:main'], { stdio: 'ignore' })
    const b = await service('b')
    await expect(b.joinVault({ url: 'http://local/empty.git', token: TOKEN, name: 'Bo', password: 'bo-long-password' })).rejects.toMatchObject({ code: 'not-a-vault' })
    expect(await b.getState()).toEqual({ status: 'no-vault' })
  })
})

describe('approving and declining', () => {
  it('declining a request removes it without changing the key', async () => {
    const { a } = await anna()
    const { pending } = await bo(a)
    expect(await a.removeMember(pending.id)).toEqual({ recoveryKey: null })
    expect(await a.listMembers()).toHaveLength(1)
  })

  it('rejects approving unknown or already approved members', async () => {
    const { a } = await anna()
    const me = (await a.listMembers())[0]!
    await expect(a.approveMember('nope')).rejects.toMatchObject({ code: 'not-found' })
    await expect(a.approveMember(me.id)).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('removing a member', () => {
  async function three() {
    const { a, recoveryKey, e } = await anna()
    const { b, pending } = await bo(a)
    await a.approveMember(pending.id)
    await a.syncNow()
    await b.checkApproval()
    await unlockByName(b, 'Bo', 'bo-long-password')
    return { a, b, boId: pending.id, recoveryKey, e }
  }

  it('changes the key, keeps data for the rest and locks the removed person out', async () => {
    const { a, b, boId, recoveryKey, e } = await three()
    const r = await a.removeMember(boId)
    expect(r.recoveryKey).toMatch(/^[A-Z2-7]{5}(-[A-Z2-7]{1,5})+$/)
    expect(r.recoveryKey).not.toBe(recoveryKey)

    // Anna still reads everything and can add new entries.
    expect(pw(a.get(e.id))).toBe('p')
    const fresh = await a.save(undefined, login('After removal', 'new-secret'))
    await a.syncNow()
    expect((await a.listMembers()).map((m) => m.name)).toEqual(['Anna'])
    a.lock()
    await unlockByName(a, 'Anna', PW)
    expect(pw(a.get(fresh.id))).toBe('new-secret')
    expect(a.list({ query: 'bank' })).toHaveLength(1) // index was rebuilt under the new key

    // The old recovery key is dead, the new one works.
    await expect(a.recoverAccess((await a.listMembers())[0]!.id, recoveryKey, 'another-long-pw')).rejects.toMatchObject({ code: 'wrong-recovery-key' })

    // Bo's computer: the next sync notices the key change and locks; Bo is no longer a member.
    const status = await b.syncNow()
    expect(status.lastError).toBeNull()
    const st = await b.getState()
    expect(st).toMatchObject({ status: 'locked' })
    expect((st as Extract<VaultState, { status: 'locked' }>).members.map((m) => m.name)).toEqual(['Anna'])
    await expect(b.unlock(boId, 'bo-long-password')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('does not let anyone remove themselves or the last member', async () => {
    const { a } = await anna()
    const me = (await a.listMembers())[0]!
    await expect(a.removeMember(me.id)).rejects.toMatchObject({ code: 'invalid' })
    await expect(a.removeMember('missing')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('refuses to rotate while entries cannot be read, leaving everything untouched', async () => {
    const { a, b, boId } = await three()
    // A corrupt entry file arrives from a sync.
    const files = (await import('node:fs/promises'))
    const dir = join(root, 'a', 'repo', 'entries')
    await files.writeFile(join(dir, '44444444-4444-4444-8444-444444444444.vault'), JSON.stringify({ format: 1, generation: 1, nonce: 'AAAA', ct: 'AAAA' }))
    await expect(a.removeMember(boId)).rejects.toMatchObject({ code: 'rotation-blocked' })
    expect((await a.listMembers()).map((m) => m.name).sort()).toEqual(['Anna', 'Bo'])
    void b
  })
})

describe('passwords', () => {
  it('changes one’s own password', async () => {
    const { a } = await anna()
    await expect(a.changePassword('wrong', 'new-long-password')).rejects.toMatchObject({ code: 'wrong-password' })
    await expect(a.changePassword(PW, 'short')).rejects.toMatchObject({ code: 'weak-password' })
    await a.changePassword(PW, 'new-long-password')
    a.lock()
    const st = (await a.getState()) as Extract<VaultState, { status: 'locked' }>
    await expect(a.unlock(st.members[0]!.id, PW)).rejects.toMatchObject({ code: 'wrong-password' })
    await a.unlock(st.members[0]!.id, 'new-long-password')
  })

  it('recovers access with the recovery key when the password is forgotten', async () => {
    const { a, recoveryKey, e } = await anna()
    a.lock()
    const st = (await a.getState()) as Extract<VaultState, { status: 'locked' }>
    const id = st.members[0]!.id
    await expect(a.recoverAccess(id, 'AAAAA-AAAAA', 'new-long-password')).rejects.toMatchObject({ code: 'bad-recovery-key' })
    await expect(a.recoverAccess(id, recoveryKey, 'short')).rejects.toMatchObject({ code: 'weak-password' })
    await a.recoverAccess(id, recoveryKey, 'new-long-password')
    expect((await a.getState()).status).toBe('unlocked')
    expect(pw(a.get(e.id))).toBe('p')
    a.lock()
    await a.unlock(id, 'new-long-password')
    await expect(a.unlock(id, PW)).rejects.toMatchObject({ code: 'wrong-password' })
  })
})
