import * as git from 'isomorphic-git'
import type { HttpClient } from 'isomorphic-git'
import fs from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ENTRY_ID_PATTERN } from '@shared/entry'
import type { EntryEnvelope } from '@shared/vault-format'

export type SyncErrorCode =
  | 'auth'
  | 'network'
  | 'no-remote'
  | 'unrelated-history'
  | 'header-conflict'
  | 'push-rejected'
  | 'unknown'

export class SyncError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'SyncError'
  }
}

/** An entry changed on both sides. The remote version was kept; ours is handed back so it can be preserved. */
export interface EntryConflict {
  id: string
  /** Our version of the file (encrypted). */
  ours: EntryEnvelope
}

export interface SyncResult {
  /** Remote changes were brought in (the index must be rebuilt). */
  pulled: boolean
  pushed: boolean
  conflicts: EntryConflict[]
  /** Member files changed on both sides; the remote version was kept. */
  memberConflicts: string[]
}

export interface GitSyncOptions {
  /** Working tree = the vault repo directory. */
  dir: string
  http: HttpClient
  /** Personal access token for the remote; asked for only when talking to the server. */
  getToken: () => Promise<string | null>
  /** Shown in `git log`; use the member's display name and a placeholder address. */
  author: () => { name: string; email: string }
  branch?: string
}

const REMOTE = 'origin'
const MAX_PUSH_ATTEMPTS = 3

/** Git operations for the vault repo, on isomorphic-git (no Git installation needed). */
export class GitSync {
  private readonly branch: string

  constructor(private readonly o: GitSyncOptions) {
    this.branch = o.branch ?? 'main'
  }

  private get base() {
    return { fs, dir: this.o.dir }
  }

  async isRepo(): Promise<boolean> {
    return fs.existsSync(join(this.o.dir, '.git'))
  }

  /** Create the repository (idempotent) and a .gitignore for our temp files. */
  async init(): Promise<void> {
    await mkdir(this.o.dir, { recursive: true })
    if (!(await this.isRepo())) await git.init({ ...this.base, defaultBranch: this.branch })
    await writeFile(join(this.o.dir, '.gitignore'), '*.tmp\n')
  }

  async remoteUrl(): Promise<string | null> {
    const remotes = await git.listRemotes(this.base)
    return remotes.find((r) => r.remote === REMOTE)?.url ?? null
  }

  async setRemote(url: string): Promise<void> {
    await git.addRemote({ ...this.base, remote: REMOTE, url, force: true })
  }

  async clearRemote(): Promise<void> {
    if (await this.remoteUrl()) await git.deleteRemote({ ...this.base, remote: REMOTE })
  }

  /** Throw away uncommitted changes in the working tree (used to undo a half-finished key rotation). */
  async discardUncommitted(): Promise<void> {
    await git.checkout({ ...this.base, ref: this.branch, force: true })
  }

  /** Clone an existing vault repository into an empty directory. */
  async clone(url: string): Promise<void> {
    await this.wrap(() =>
      git.clone({
        ...this.base,
        http: this.o.http,
        url,
        remote: REMOTE,
        ref: this.branch,
        singleBranch: true,
        noTags: true,
        onAuth: () => this.auth()
      })
    )
  }

  /** Commit every change in the working tree. Returns false when there was nothing to commit. */
  async commitAll(message: string): Promise<boolean> {
    const matrix = await git.statusMatrix(this.base)
    let changed = false
    for (const [file, head, work, stage] of matrix) {
      if (head === 1 && work === 1 && stage === 1) continue
      changed = true
      if (work === 0) await git.remove({ ...this.base, filepath: file! })
      else await git.add({ ...this.base, filepath: file! })
    }
    if (!changed) return false
    await git.commit({ ...this.base, message, author: this.o.author() })
    return true
  }

  private async auth(): Promise<{ username: string; password: string }> {
    const token = await this.o.getToken()
    if (!token) throw new SyncError('auth', 'No access token is configured')
    return { username: 'x-access-token', password: token }
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw this.mapError(e)
    }
  }

  private mapError(e: unknown): SyncError {
    if (e instanceof SyncError) return e
    const err = e as { name?: string; code?: string; data?: { statusCode?: number }; message?: string }
    if (err.name === 'HttpError' && [401, 403].includes(err.data?.statusCode ?? 0)) {
      return new SyncError('auth', 'GitHub rejected the access token (expired, wrong, or without access to this repository)')
    }
    if (err.name === 'UserCanceledError' || err.code === 'HttpError') {
      return new SyncError('auth', 'GitHub rejected the access token')
    }
    if (err.name === 'PushRejectedError' || err.name === 'GitPushError') return new SyncError('push-rejected', 'The remote has newer changes')
    if (err.name === 'NotFoundError' || (err.name === 'HttpError' && err.data?.statusCode === 404)) {
      return new SyncError('no-remote', 'Repository not found (check the address and the token permissions)')
    }
    if (typeof err.code === 'string' && /^(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN)$/.test(err.code)) {
      return new SyncError('network', 'Cannot reach GitHub (offline?)')
    }
    return new SyncError('unknown', err.message ?? 'Sync failed')
  }

  private async tryResolve(ref: string): Promise<string | null> {
    try {
      return await git.resolveRef({ ...this.base, ref })
    } catch {
      return null
    }
  }

  /** Fetch the remote branch. Returns its commit, or null when the remote has no such branch yet. */
  private async fetchRemote(): Promise<string | null> {
    try {
      await git.fetch({
        ...this.base,
        http: this.o.http,
        remote: REMOTE,
        ref: this.branch,
        singleBranch: true,
        tags: false,
        onAuth: () => this.auth()
      })
    } catch (e) {
      const mapped = this.mapError(e)
      if (mapped.code !== 'no-remote') throw mapped
      // An empty repository (nothing pushed yet) is normal on first sync.
      if (!(await this.remoteIsEmpty())) throw mapped
      return null
    }
    return this.tryResolve(`refs/remotes/${REMOTE}/${this.branch}`)
  }

  private async remoteIsEmpty(): Promise<boolean> {
    try {
      const refs = await git.listServerRefs({ http: this.o.http, url: (await this.remoteUrl())!, onAuth: () => this.auth() })
      return refs.length === 0
    } catch {
      return false
    }
  }

  /**
   * Commit local changes, merge remote changes and push. Entries edited on both
   * sides keep the remote version and are returned as conflicts; `onMerged` is
   * called after the merge (before pushing) so the caller can add files such as
   * conflict copies, which are then committed and pushed too.
   */
  async sync(opts: { onMerged?: (r: SyncResult) => Promise<void> } = {}): Promise<SyncResult> {
    if (!(await this.remoteUrl())) throw new SyncError('no-remote', 'No remote repository is configured')
    const result: SyncResult = { pulled: false, pushed: false, conflicts: [], memberConflicts: [] }
    await this.commitAll('Update vault')

    for (let attempt = 1; ; attempt++) {
      const theirs = await this.wrap(() => this.fetchRemote())
      const ours = await this.tryResolve(`refs/heads/${this.branch}`)

      if (theirs && ours && theirs !== ours) {
        if (await git.isDescendent({ ...this.base, oid: theirs, ancestor: ours })) {
          await this.fastForwardTo(theirs)
          result.pulled = true
        } else if (!(await git.isDescendent({ ...this.base, oid: ours, ancestor: theirs }))) {
          await this.mergeDivergent(ours, theirs, result)
          result.pulled = true
        }
      } else if (theirs && !ours) {
        await this.fastForwardTo(theirs)
        result.pulled = true
      }

      if (result.pulled && opts.onMerged) {
        await opts.onMerged(result)
        await this.commitAll('Add conflict copies')
        opts = {} // only once
      }

      if (!(await this.tryResolve(`refs/heads/${this.branch}`))) return result // nothing to push
      const head = await this.tryResolve(`refs/heads/${this.branch}`)
      if (head === (await this.tryResolve(`refs/remotes/${REMOTE}/${this.branch}`))) return result

      try {
        await git.push({
          ...this.base,
          http: this.o.http,
          remote: REMOTE,
          ref: this.branch,
          onAuth: () => this.auth()
        })
        result.pushed = true
        return result
      } catch (e) {
        const mapped = this.mapError(e)
        if (mapped.code !== 'push-rejected' || attempt >= MAX_PUSH_ATTEMPTS) throw mapped
        // Someone pushed in between: fetch and merge again.
      }
    }
  }

  private async fastForwardTo(oid: string): Promise<void> {
    await git.writeRef({ ...this.base, ref: `refs/heads/${this.branch}`, value: oid, force: true })
    await git.checkout({ ...this.base, ref: this.branch, force: true })
  }

  /** Three-way merge at file level; our own policy decides every conflicting file. */
  private async mergeDivergent(ours: string, theirs: string, result: SyncResult): Promise<void> {
    const [baseOid] = await git.findMergeBase({ ...this.base, oids: [ours, theirs] })
    if (!baseOid) throw new SyncError('unrelated-history', 'The remote repository contains a different vault')

    type Row = { path: string; base?: string; ours?: string; theirs?: string }
    const rows: Row[] = []
    await git.walk({
      ...this.base,
      trees: [git.TREE({ ref: baseOid }), git.TREE({ ref: ours }), git.TREE({ ref: theirs })],
      map: async (path, [b, o, t]) => {
        if (path === '.') return undefined
        const types = await Promise.all([b?.type(), o?.type(), t?.type()])
        if (types.some((x) => x === 'tree')) return undefined // descend into directories
        const [bo, oo, to] = await Promise.all([b?.oid(), o?.oid(), t?.oid()])
        if (bo !== oo || bo !== to) rows.push({ path, base: bo, ours: oo, theirs: to })
        return undefined
      }
    })

    for (const r of rows) {
      if (r.ours === r.theirs) continue // identical change on both sides
      if (r.ours === r.base) {
        await this.take(r.path, r.theirs) // only they changed it
        continue
      }
      if (r.theirs === r.base) continue // only we changed it
      // Changed on both sides.
      const id = /^entries\/(.+)\.vault$/.exec(r.path)?.[1]
      if (id && ENTRY_ID_PATTERN.test(id)) {
        if (r.ours && !r.theirs) continue // we edited, they deleted: keep our edit
        if (r.ours && r.theirs) {
          const blob = await git.readBlob({ ...this.base, oid: r.ours })
          result.conflicts.push({ id, ours: JSON.parse(Buffer.from(blob.blob).toString('utf8')) as EntryEnvelope })
        }
        await this.take(r.path, r.theirs) // remote edit wins the original; ours is preserved as a copy
      } else if (r.path.startsWith('members/')) {
        result.memberConflicts.push(r.path)
        await this.take(r.path, r.theirs)
      } else {
        throw new SyncError('header-conflict', `${r.path} was changed on two computers at once and needs manual attention`)
      }
    }

    await git.add({ ...this.base, filepath: '.gitignore' }).catch(() => undefined)
    await git.commit({
      ...this.base,
      message: 'Merge remote changes',
      author: this.o.author(),
      parent: [ours, theirs]
    })
  }

  /** Make `path` equal to the given blob (or delete it) in the working tree and index. */
  private async take(path: string, oid: string | undefined): Promise<void> {
    const file = join(this.o.dir, path)
    if (!oid) {
      await rm(file, { force: true })
      await git.remove({ ...this.base, filepath: path })
      return
    }
    const { blob } = await git.readBlob({ ...this.base, oid })
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, blob)
    await git.add({ ...this.base, filepath: path })
  }
}
