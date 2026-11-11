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
  copy: (text) => call('clipboard:copy', text),
  onLocked: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('vault:locked', listener)
    return () => ipcRenderer.removeListener('vault:locked', listener)
  }
} satisfies RawVaultApi
contextBridge.exposeInMainWorld('vault', api)
