import { clipboard, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { EntryType } from '@shared/entry'
import { ENTRY_TYPES } from '@shared/entry'
import type { Result as IpcResult } from '@shared/api'
import { UserError, type VaultService } from './vault-service'

const CLIPBOARD_CLEAR_MS = 30_000

function asString(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new UserError('invalid', `${what} must be text`)
  return v
}

function asType(v: unknown): EntryType | undefined {
  if (v === undefined) return undefined
  if (!ENTRY_TYPES.includes(v as EntryType)) throw new UserError('invalid', 'Unknown entry type')
  return v as EntryType
}

/** Register all IPC handlers. Only calls from `window` are accepted. */
export function registerIpc(service: VaultService, window: () => WebContents | undefined, info: () => unknown): void {
  let clipboardTimer: NodeJS.Timeout | undefined

  const handle = <T>(channel: string, fn: (...args: unknown[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult<T>> => {
      if (event.sender !== window()) return { ok: false, code: 'forbidden', message: 'Forbidden' }
      try {
        return { ok: true, value: await fn(...args) }
      } catch (e) {
        if (e instanceof UserError) return { ok: false, code: e.code, message: e.message }
        console.error(`[ipc ${channel}]`, e instanceof Error ? e.name : 'error') // never log arguments or messages that may hold secrets
        return { ok: false, code: 'internal', message: 'Something went wrong' }
      }
    })
  }

  handle('app:info', () => info())
  handle('vault:state', () => service.getState())
  handle('vault:create', (a) => {
    const x = a as { name?: unknown; password?: unknown }
    return service.createVault(asString(x?.name, 'Name'), asString(x?.password, 'Password'))
  })
  handle('vault:unlock', (a) => {
    const x = a as { memberId?: unknown; password?: unknown }
    return service.unlock(asString(x?.memberId, 'Member'), asString(x?.password, 'Password'))
  })
  handle('vault:lock', () => service.lock())
  ipcMain.on('vault:touch', (event) => {
    if (event.sender === window()) service.touch()
  })
  handle('entries:list', (a) => {
    const x = (a ?? {}) as { type?: unknown; query?: unknown }
    return service.list({ type: asType(x.type), query: x.query === undefined ? undefined : asString(x.query, 'Query') })
  })
  handle('entries:get', (id) => service.get(asString(id, 'Id')))
  handle('entries:save', (a) => {
    const x = (a ?? {}) as { id?: unknown; input?: unknown }
    return service.save(x.id === undefined ? undefined : asString(x.id, 'Id'), x.input)
  })
  handle('entries:delete', (id) => service.delete(asString(id, 'Id')))
  handle('vault:join', (a) => {
    const x = (a ?? {}) as Record<string, unknown>
    return service.joinVault({
      url: asString(x.url, 'Address'),
      token: asString(x.token, 'Token'),
      name: asString(x.name, 'Name'),
      password: asString(x.password, 'Password')
    })
  })
  handle('vault:checkApproval', () => service.checkApproval())
  handle('members:list', () => service.listMembers())
  handle('members:approve', (id) => service.approveMember(asString(id, 'Id')))
  handle('members:remove', (id) => service.removeMember(asString(id, 'Id')))
  handle('members:changePassword', (a) => {
    const x = (a ?? {}) as Record<string, unknown>
    return service.changePassword(asString(x.oldPassword, 'Password'), asString(x.newPassword, 'Password'))
  })
  handle('vault:recover', async (a) => {
    const x = (a ?? {}) as Record<string, unknown>
    await service.recoverAccess(asString(x.memberId, 'Member'), asString(x.recoveryKey, 'Recovery key'), asString(x.newPassword, 'Password'))
  })
  handle('sync:status', () => service.getSyncStatus())
  handle('sync:connect', (a) => {
    const x = (a ?? {}) as { url?: unknown; token?: unknown }
    return service.connectRemote(asString(x.url, 'Address'), asString(x.token, 'Token'))
  })
  handle('sync:now', () => service.syncNow())
  handle('sync:disconnect', () => service.disconnectRemote())
  handle('entries:resolveConflict', (a) => {
    const x = (a ?? {}) as { id?: unknown; keepCopy?: unknown }
    return service.resolveConflict(asString(x.id, 'Id'), x.keepCopy === true)
  })
  handle('clipboard:copy', (text) => {
    const value = asString(text, 'Text')
    service.touch()
    clipboard.writeText(value)
    clearTimeout(clipboardTimer)
    clipboardTimer = setTimeout(() => {
      void Promise.resolve(clipboard.readText()).then((current) => {
        if (current === value) clipboard.clear()
      })
    }, CLIPBOARD_CLEAR_MS)
  })
}
