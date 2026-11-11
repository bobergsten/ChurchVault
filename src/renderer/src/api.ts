import { ApiError, type RawVaultApi, type Result, type VaultApi } from '@shared/api'

async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new ApiError(r.code, r.message)
  return r.value
}

const raw: RawVaultApi = window.vault

/** The vault API with failures thrown as `ApiError`. */
export const api: VaultApi = {
  getInfo: () => unwrap(raw.getInfo()),
  getState: () => unwrap(raw.getState()),
  createVault: (a) => unwrap(raw.createVault(a)),
  unlock: (a) => unwrap(raw.unlock(a)),
  lock: () => unwrap(raw.lock()),
  touch: () => raw.touch(),
  listEntries: (a) => unwrap(raw.listEntries(a)),
  getEntry: (id) => unwrap(raw.getEntry(id)),
  saveEntry: (a) => unwrap(raw.saveEntry(a)),
  deleteEntry: (id) => unwrap(raw.deleteEntry(id)),
  joinVault: (a) => unwrap(raw.joinVault(a)),
  checkApproval: () => unwrap(raw.checkApproval()),
  listMembers: () => unwrap(raw.listMembers()),
  approveMember: (id) => unwrap(raw.approveMember(id)),
  removeMember: (id) => unwrap(raw.removeMember(id)),
  changePassword: (a) => unwrap(raw.changePassword(a)),
  recoverAccess: (a) => unwrap(raw.recoverAccess(a)),
  pickAttachments: () => unwrap(raw.pickAttachments()),
  previewAttachment: (id) => unwrap(raw.previewAttachment(id)),
  saveAttachment: (id) => unwrap(raw.saveAttachment(id)),
  openAttachment: (id) => unwrap(raw.openAttachment(id)),
  getSyncStatus: () => unwrap(raw.getSyncStatus()),
  connectRemote: (a) => unwrap(raw.connectRemote(a)),
  syncNow: () => unwrap(raw.syncNow()),
  disconnectRemote: () => unwrap(raw.disconnectRemote()),
  resolveConflict: (a) => unwrap(raw.resolveConflict(a)),
  onSyncStatus: (cb) => raw.onSyncStatus(cb),
  copy: (t) => unwrap(raw.copy(t)),
  onLocked: (cb) => raw.onLocked(cb)
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong'
}
