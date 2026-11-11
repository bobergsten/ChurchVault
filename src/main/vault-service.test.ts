import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fastKdfParamsForTests } from './crypto'
import { MemorySecretStore } from './secret-store'
import { UserError, VaultService } from './vault-service'

let dir: string
let locked = 0
const login = { type: 'login', title: 'Bank', tags: [], favorite: false, notes: '', attachments: [], fields: { url: 'u', username: 'x', password: 'p' } }

async function service(idleMs = 0): Promise<VaultService> {
  return new VaultService({ repoDir: join(dir, 'repo'), dataDir: join(dir, 'data'), kdf: await fastKdfParamsForTests(), idleMs, onLocked: () => locked++, http: {} as never, secrets: new MemorySecretStore() })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cv-svc-'))
  await import('node:fs/promises').then((fs) => fs.mkdir(join(dir, 'data'), { recursive: true }))
  locked = 0
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

describe('VaultService', () => {
  it('goes through no-vault -> locked -> unlocked', async () => {
    const s = await service()
    expect(await s.getState()).toEqual({ status: 'no-vault' })
    const { recoveryKey } = await s.createVault('Anna', 'long-enough-pw')
    expect(recoveryKey).toMatch(/^[A-Z2-7]{5}(-[A-Z2-7]{1,5})+$/)
    const state = await s.getState()
    expect(state.status).toBe('locked')
    if (state.status !== 'locked') return
    expect(state.members.map((m) => m.name)).toEqual(['Anna'])
    await s.unlock(state.members[0]!.id, 'long-enough-pw')
    expect((await s.getState()).status).toBe('unlocked')
  })

  it('validates vault creation and refuses to overwrite', async () => {
    const s = await service()
    await expect(s.createVault('  ', 'long-enough-pw')).rejects.toMatchObject({ code: 'name-required' })
    await expect(s.createVault('Anna', 'short')).rejects.toMatchObject({ code: 'weak-password' })
    await s.createVault('Anna', 'long-enough-pw')
    await expect(s.createVault('Eve', 'long-enough-pw')).rejects.toMatchObject({ code: 'exists' })
  })

  it('rejects the wrong password with a user-facing error', async () => {
    const s = await service()
    await s.createVault('Anna', 'long-enough-pw')
    const st = await s.getState()
    if (st.status !== 'locked') throw new Error()
    await expect(s.unlock(st.members[0]!.id, 'wrong')).rejects.toMatchObject({ code: 'wrong-password' })
    await expect(s.unlock('nope', 'x')).rejects.toBeInstanceOf(UserError)
  })

  it('blocks data access while locked and wipes state on lock', async () => {
    const s = await service()
    await s.createVault('Anna', 'long-enough-pw')
    expect(() => s.list({})).toThrow(/locked/)
    const st = await s.getState()
    if (st.status !== 'locked') throw new Error()
    await s.unlock(st.members[0]!.id, 'long-enough-pw')
    const e = await s.save(undefined, login)
    expect(s.list({}).map((r) => r.id)).toEqual([e.id])
    s.lock()
    expect(locked).toBe(1)
    expect(() => s.get(e.id)).toThrow(/locked/)
  })

  it('keeps data across lock/unlock and across a new service instance', async () => {
    const s1 = await service()
    await s1.createVault('Anna', 'long-enough-pw')
    let st = await s1.getState()
    if (st.status !== 'locked') throw new Error()
    const id = st.members[0]!.id
    await s1.unlock(id, 'long-enough-pw')
    const e = await s1.save(undefined, login)
    s1.lock()

    const s2 = await service()
    st = await s2.getState()
    expect(st.status).toBe('locked')
    expect(await s2.unlock(id, 'long-enough-pw')).toEqual({ unreadable: 0 })
    expect(s2.get(e.id)?.title).toBe('Bank')
    await s2.save(e.id, { ...login, title: 'Bank 2' })
    expect(s2.list({ query: 'bank' })[0]?.title).toBe('Bank 2')
    await s2.delete(e.id)
    expect(s2.list({})).toEqual([])
    s2.lock()
  })

  it('turns invalid input into a user error', async () => {
    const s = await service()
    await s.createVault('Anna', 'long-enough-pw')
    const st = await s.getState()
    if (st.status !== 'locked') throw new Error()
    await s.unlock(st.members[0]!.id, 'long-enough-pw')
    await expect(s.save(undefined, { ...login, title: '' })).rejects.toMatchObject({ code: 'invalid' })
    s.lock()
  })

  it('auto-locks after the idle time and touch() postpones it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const s = await service(1000)
    await s.createVault('Anna', 'long-enough-pw')
    const st = await s.getState()
    if (st.status !== 'locked') throw new Error()
    await s.unlock(st.members[0]!.id, 'long-enough-pw')
    vi.advanceTimersByTime(800)
    s.touch()
    vi.advanceTimersByTime(800)
    expect(locked).toBe(0)
    vi.advanceTimersByTime(300)
    expect(locked).toBe(1)
  })
})
