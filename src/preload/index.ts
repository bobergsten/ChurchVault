import { contextBridge, ipcRenderer } from 'electron'
import type { RawVaultApi } from '@shared/api'

const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api = {
  getInfo: () => call('app:info'),
  getState: () => call('vault:state'),
  createVault: (args) => call('vault:create', args),
  unlock: (args) => call('vault:unlock', args),
  lock: () => call('vault:lock'),
  touch: () => ipcRenderer.send('vault:touch'),
  listEntries: (args) => call('entries:list', args),
  getEntry: (id) => call('entries:get', id),
  saveEntry: (args) => call('entries:save', args),
  deleteEntry: (id) => call('entries:delete', id),
  joinVault: (args) => call('vault:join', args),
  checkApproval: () => call('vault:checkApproval'),
  listMembers: () => call('members:list'),
  approveMember: (id) => call('members:approve', id),
  removeMember: (id) => call('members:remove', id),
  changePassword: (args) => call('members:changePassword', args),
  recoverAccess: (args) => call('vault:recover', args),
  pickAttachments: () => call('attachments:pick'),
  previewAttachment: (id) => call('attachments:preview', id),
  saveAttachment: (id) => call('attachments:save', id),
  openAttachment: (id) => call('attachments:open', id),
  getUpdateStatus: () => call('update:status'),
  onUpdateStatus: (cb) => {
    const listener = (_e: unknown, status: Parameters<typeof cb>[0]): void => cb(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  installUpdate: () => call('update:install'),
  openUpdatePage: () => call('update:openPage'),
  getSyncStatus: () => call('sync:status'),
  connectRemote: (args) => call('sync:connect', args),
  syncNow: () => call('sync:now'),
  updateToken: (token) => call('sync:updateToken', token),
  disconnectRemote: () => call('sync:disconnect'),
  resolveConflict: (args) => call('entries:resolveConflict', args),
  onSyncStatus: (cb) => {
    const listener = (_e: unknown, status: Parameters<typeof cb>[0]): void => cb(status)
    ipcRenderer.on('sync:status', listener)
    return () => ipcRenderer.removeListener('sync:status', listener)
  },
  copy: (text) => call('clipboard:copy', text),
  onLocked: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('vault:locked', listener)
    return () => ipcRenderer.removeListener('vault:locked', listener)
  }
} satisfies RawVaultApi
contextBridge.exposeInMainWorld('vault', api)
