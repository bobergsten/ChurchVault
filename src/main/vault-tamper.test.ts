import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VaultState } from '@shared/api'
import type { MemberFile } from '@shared/vault-format'
import { VaultSession, attestMember, fastKdfParamsForTests } from './crypto'
import { getSodium } from './crypto/sodium'
import { MemorySecretStore } from './secret-store'
import { GitSync } from './sync/git-sync'
import { localGitServer } from './sync/local-http'
import { VaultService } from './vault-service'

const TOKEN = 'ghp_tamper'
const URL = 'http://local/vault.git'
const PW = 'anna-long-password'
const login = (title: string) =>
  ({ type: 'login', title, tags: [], favorite: false, notes: '', attachments: [], fields: { url: 'u', username: 'x', password: 'p' } }) as const

let root: string
let server: ReturnType<typeof localGitServer>

async function service(name: string, secrets = new MemorySecretStore()) {
  mkdirSync(join(root, name, 'data'), { recursive: true })
  return new VaultService({ repoDir: join(root, name, 'repo'), dataDir: join(root, name, 'data'), kdf: await fastKdfParamsForTests(), http: server.http, secrets, allowedRemote: /^http:\/\/local\// })
}
const memberPath = (dev: string, id: string) => join(root, dev, 'repo', 'members', `${id}.json`)
const readMember = (dev: string, id: string): MemberFile => JSON.parse(readFileSync(memberPath(dev, id), 'utf8')) as MemberFile
const writeMember = (dev: string, m: MemberFile): void => writeFileSync(memberPath(dev, m.id), JSON.stringify(m))

/** What an attacker with only repo write access can do: seal and "attest" a key they made up. */
async function plantKey(m: MemberFile, vaultId: string, generation: number): Promise<MemberFile> {
  const s = await getSodium()
  const evilKey = s.randombytes_buf(32)
  const evil = new VaultSession(evilKey.slice(), vaultId, generation)
  return attestMember(evil, { ...m, sealedVaultKey: { generation, ct: s.to_base64(s.crypto_box_seal(evilKey, s.from_base64(m.publicKey))) } })
}

async function anna() {
  const a = await service('a')
  await a.createVault('Anna', PW)
  const st = (await a.getState()) as Extract<VaultState, { status: 'locked' }>
  const id = st.members[0]!.id
  await a.unlock(id, PW)
  await a.save(undefined, login('Bank'))
  const vaultId = JSON.parse(readFileSync(join(root, 'a', 'repo', 'vault.json'), 'utf8')).vaultId as string
  return { a, id, vaultId }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cv-tamper-'))
  execFileSync('git', ['init', '--bare', '-b', 'main', join(root, 'vault.git')], { stdio: 'ignore' })
  server = localGitServer(root, TOKEN)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('a planted vault key', () => {
  it('is refused on a computer that trusted the real key before', async () => {
    const { a, id, vaultId } = await anna()
    a.lock()
    writeMember('a', await plantKey(readMember('a', id), vaultId, 1))
    await expect(a.unlock(id, PW)).rejects.toMatchObject({ code: 'tampered' })
    expect((await a.getState()).status).toBe('locked')
  })

  it('is refused even when disguised as a newer key generation', async () => {
    const { a, id, vaultId } = await anna()
    a.lock()
    const header = JSON.parse(readFileSync(join(root, 'a', 'repo', 'vault.json'), 'utf8'))
    writeFileSync(join(root, 'a', 'repo', 'vault.json'), JSON.stringify({ ...header, generation: 2 }))
    writeMember('a', await plantKey(readMember('a', id), vaultId, 2))
    await expect(a.unlock(id, PW)).rejects.toMatchObject({ code: 'tampered' })
  })

  it('is refused on a brand-new computer when it cannot read the existing entries', async () => {
    const { a, id, vaultId } = await anna()
    await a.connectRemote(URL, TOKEN)
    // The attacker pushes a planted key for Anna.
    const evilDir = join(root, 'evil')
    execFileSync('git', ['clone', '-q', join(root, 'vault.git'), evilDir])
    const m = JSON.parse(readFileSync(join(evilDir, 'members', `${id}.json`), 'utf8')) as MemberFile
    writeFileSync(join(evilDir, 'members', `${id}.json`), JSON.stringify(await plantKey(m, vaultId, 1)))
    execFileSync('git', ['-C', evilDir, '-c', 'user.name=e', '-c', 'user.email=e@e', 'commit', '-qam', 'x'])
    execFileSync('git', ['-C', evilDir, 'push', '-q', 'origin', 'HEAD:main'], { stdio: 'ignore' })

    // Anna sets up a second computer.
    const secrets = new MemorySecretStore()
    await secrets.set('github-token', TOKEN)
    const b = await service('b', secrets)
    await new GitSync({ dir: join(root, 'b', 'repo'), http: server.http, getToken: async () => TOKEN, author: () => ({ name: 'b', email: 'b@x.invalid' }) }).clone(URL)
    await expect(b.unlock(id, PW)).rejects.toMatchObject({ code: 'tampered' })
    expect(readdirSync(join(root, 'b', 'data'))).not.toContain('trusted-key.json')
  })
})

describe('a swapped member public key', () => {
  it('is flagged, and blocks key rotation until that member is removed', async () => {
    const { a } = await anna()
    await a.connectRemote(URL, TOKEN)
    const join2 = async (name: string) => {
      const d = await service(name)
      await d.joinVault({ url: URL, token: TOKEN, name, password: `${name}-long-password` })
      await a.syncNow()
      const p = (await a.listMembers()).find((m) => m.pending)!
      await a.approveMember(p.id)
      return p.id
    }
    const boId = await join2('bo')
    const cyId = await join2('cy')
    expect((await a.listMembers()).every((m) => m.verified)).toBe(true)

    // Attacker replaces Bo's public key with their own.
    const fake = (await (await import('./crypto')).createMemberIdentity({ name: 'bo', password: 'x', kdf: await fastKdfParamsForTests() })).publicKey
    writeMember('a', { ...readMember('a', boId), publicKey: fake })
    expect((await a.listMembers()).find((m) => m.id === boId)?.verified).toBe(false)
    await expect(a.removeMember(cyId)).rejects.toMatchObject({ code: 'untrusted-member' })
    // Removing the tampered entry itself is allowed, then everything is consistent again.
    expect((await a.removeMember(boId)).recoveryKey).toBeTruthy()
    expect((await a.listMembers()).every((m) => m.verified || m.pending)).toBe(true)
  })
})

describe('a legitimate key change', () => {
  it('is accepted by other members’ computers through the key chain', async () => {
    const { a } = await anna()
    await a.connectRemote(URL, TOKEN)
    const bo = await service('bo')
    await bo.joinVault({ url: URL, token: TOKEN, name: 'Bo', password: 'bo-long-password' })
    const cy = await service('cy')
    await cy.joinVault({ url: URL, token: TOKEN, name: 'Cy', password: 'cy-long-password' })
    await a.syncNow()
    for (const m of (await a.listMembers()).filter((x) => x.pending)) await a.approveMember(m.id)
    await a.syncNow()
    await bo.checkApproval()
    const boState = (await bo.getState()) as Extract<VaultState, { status: 'locked' }>
    const boId = boState.members.find((m) => m.name === 'Bo')!.id
    await bo.unlock(boId, 'bo-long-password') // Bo's computer now trusts generation 1
    const cyId = (await a.listMembers()).find((m) => m.name === 'Cy')!.id

    await a.removeMember(cyId) // generation 2
    await bo.syncNow() // notices the new key and locks
    expect((await bo.getState()).status).toBe('locked')
    await bo.unlock(boId, 'bo-long-password') // verified through the chain
    expect(bo.list({ query: 'bank' })).toHaveLength(1)
    const pins = JSON.parse(readFileSync(join(root, 'bo', 'data', 'trusted-key.json'), 'utf8'))
    expect(Object.values(pins)[0]).toMatchObject({ generation: 2 })
  })
})
