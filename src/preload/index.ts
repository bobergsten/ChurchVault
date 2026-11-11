import { contextBridge, ipcRenderer } from 'electron'
import type { VaultApi } from '@shared/api'

const api: VaultApi = {
  getInfo: () => ipcRenderer.invoke('app:info')
}
contextBridge.exposeInMainWorld('vault', api)
