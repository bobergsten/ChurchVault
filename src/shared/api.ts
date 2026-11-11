import type { Entry, EntryInput, EntryType } from './entry'

export interface AppInfo {
  platform: string
  version: string
}

export interface MemberSummary {
  id: string
  name: string
}

export type VaultState =
  | { status: 'no-vault' }
  | { status: 'locked'; members: MemberSummary[] }
  | { status: 'unlocked'; me: MemberSummary }

export interface EntrySummary {
  id: string
  type: EntryType
  title: string
  tags: string[]
  favorite: boolean
  updatedAt: string
  updatedBy: string
}

/** Error thrown in the renderer for a failed call. `code` is stable, `message` is user-presentable. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

/** API exposed from the main process to the renderer through the preload script. */
export interface VaultApi {
  getInfo(): Promise<AppInfo>
  getState(): Promise<VaultState>
  createVault(args: { name: string; password: string }): Promise<{ recoveryKey: string }>
  unlock(args: { memberId: string; password: string }): Promise<{ unreadable: number }>
  lock(): Promise<void>
  /** Tell main the user is active, to postpone auto-lock. */
  touch(): void
  listEntries(args: { type?: EntryType; query?: string }): Promise<EntrySummary[]>
  getEntry(id: string): Promise<Entry | null>
  saveEntry(args: { id?: string; input: EntryInput }): Promise<Entry>
  deleteEntry(id: string): Promise<void>
  /** Copy to the clipboard; main clears it after a delay if unchanged. */
  copy(text: string): Promise<void>
  /** Subscribe to auto-lock; returns an unsubscribe function. */
  onLocked(cb: () => void): () => void
}

export type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

/**
 * What the preload script actually exposes: every async call resolves to a
 * Result, because custom error properties do not survive the context bridge.
 * The renderer wraps this back into `VaultApi` (see renderer/src/api.ts).
 */
export type RawVaultApi = {
  [K in keyof VaultApi]: VaultApi[K] extends (...a: infer A) => Promise<infer R>
    ? (...a: A) => Promise<Result<R>>
    : VaultApi[K]
}
