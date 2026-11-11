import type { AttachmentPreview, AttachmentRef, Entry, EntryInput, EntryType } from './entry'

export interface AppInfo {
  platform: string
  version: string
}

export interface MemberSummary {
  id: string
  name: string
}

export interface MemberInfo extends MemberSummary {
  /** has no access yet: waiting for an existing member to approve */
  pending: boolean
  /** short code both people compare when approving, e.g. "1A2B 3C4D …" */
  fingerprint: string
  isMe: boolean
  /** has access and the member file is vouched for by the vault key (false = possibly tampered with) */
  verified: boolean
}

export type VaultState =
  | { status: 'no-vault' }
  /** This computer asked to join and is waiting for an admin. */
  | { status: 'pending'; member: MemberSummary; fingerprint: string }
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
  /** set when this is a preserved copy from an edit conflict */
  conflictOf?: string
}

export interface SyncStatus {
  configured: boolean
  /** e.g. https://github.com/church/vault.git */
  remoteUrl: string | null
  syncing: boolean
  lastSyncAt: string | null
  lastError: { code: string; message: string } | null
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
  /** Ask to join an existing vault stored in a GitHub repository. Returns the fingerprint to read out to an admin. */
  joinVault(args: { url: string; token: string; name: string; password: string }): Promise<{ fingerprint: string }>
  /** Pending computer: fetch from GitHub to see whether access has been granted. */
  checkApproval(): Promise<VaultState>
  listMembers(): Promise<MemberInfo[]>
  approveMember(id: string): Promise<void>
  /**
   * Remove a member and change the vault key. Returns the new recovery key (the old one stops working),
   * or null when only a pending request was declined and the key stayed the same.
   */
  removeMember(id: string): Promise<{ recoveryKey: string | null }>
  changePassword(args: { oldPassword: string; newPassword: string }): Promise<void>
  /** Forgotten password: reset one's own access using the printed recovery key, then unlock. */
  recoverAccess(args: { memberId: string; recoveryKey: string; newPassword: string }): Promise<void>
  /** Choose files with the system dialog; they are encrypted and kept until the entry is saved. */
  pickAttachments(): Promise<AttachmentRef[]>
  previewAttachment(id: string): Promise<AttachmentPreview>
  /** Save a decrypted copy where the user chooses. Resolves false if cancelled. */
  saveAttachment(id: string): Promise<boolean>
  /** Open with the default app via a temporary decrypted copy that is deleted when the vault locks. */
  openAttachment(id: string): Promise<void>
  getSyncStatus(): Promise<SyncStatus>
  /** Connect this vault to a GitHub repository and run the first sync. The token is stored in the OS keychain. */
  connectRemote(args: { url: string; token: string }): Promise<SyncStatus>
  syncNow(): Promise<SyncStatus>
  disconnectRemote(): Promise<SyncStatus>
  /** Resolve an edit conflict: keep the preserved copy (replacing the original) or discard it. */
  resolveConflict(args: { id: string; keepCopy: boolean }): Promise<void>
  /** Subscribe to sync status changes. */
  onSyncStatus(cb: (s: SyncStatus) => void): () => void
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
