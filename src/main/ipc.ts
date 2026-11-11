import { BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { safeFileName } from './attachments'
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

/** Remove temporary decrypted copies made by "Open". Called when the vault locks, and on start and quit. */
export async function cleanOpenDir(openDir: string): Promise<void> {
  await rm(openDir, { recursive: true, force: true }).catch(() => undefined) // a file may still be open in another app
}

let lastCopied: string | null = null

/** Clear the clipboard if it still holds something we put there (on lock and quit). */
export async function clearClipboardIfOurs(): Promise<void> {
  if (lastCopied !== null && (await Promise.resolve(clipboard.readText())) === lastCopied) clipboard.clear()
  lastCopied = null
}

/**
 * "Open" hands the file to another program. Only document and image types: never
 * anything the system would run (.exe, .bat, .app, .lnk, scripts, installers...).
 */
const OPENABLE = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'tif', 'tiff', 'bmp',
  'txt', 'md', 'csv', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pages', 'numbers', 'key'
])
export function isOpenable(fileName: string): boolean {
  const m = /\.([a-z0-9]+)$/i.exec(fileName)
  return !!m && OPENABLE.has(m[1]!.toLowerCase())
}

export interface IpcOptions {
  window: () => WebContents | undefined
  info: () => unknown
  openDir: string
  updater: { status: () => unknown; install: (beforeQuit: () => void) => void; openDownloadPage: () => void }
  /** Origin of our own page; calls from any other frame are refused. */
  origin: string
}

/** Register all IPC handlers. Only calls from our window's own page are accepted. */
export function registerIpc(service: VaultService, { window, info, openDir, origin, updater }: IpcOptions): void {
  const trusted = (event: { sender: WebContents; senderFrame?: { url: string; parent: unknown } | null }): boolean => {
    const frame = event.senderFrame
    return event.sender === window() && !!frame && frame.parent === null && (frame.url === origin || frame.url.startsWith(origin + '/'))
  }
  const owner = (): BrowserWindow | undefined => {
    const wc = window()
    return wc ? (BrowserWindow.fromWebContents(wc) ?? undefined) : undefined
  }
  let clipboardTimer: NodeJS.Timeout | undefined

  const handle = <T>(channel: string, fn: (...args: unknown[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult<T>> => {
      if (!trusted(event)) return { ok: false, code: 'forbidden', message: 'Forbidden' }
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
  handle('update:status', () => updater.status())
  handle('update:install', () =>
    updater.install(() => {
      service.lock()
      void clearClipboardIfOurs()
    })
  )
  handle('update:openPage', () => updater.openDownloadPage())
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
    if (trusted(event)) service.touch()
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
  handle('attachments:pick', async () => {
    const win = owner()
    const opts = { title: 'Attach files', properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled) return []
    const refs = []
    for (const p of r.filePaths) refs.push(await service.addAttachmentFromPath(p))
    return refs
  })
  handle('attachments:preview', (id) => service.previewAttachment(asString(id, 'Id')))
  handle('attachments:save', async (id) => {
    const { ref, data } = await service.readAttachment(asString(id, 'Id'))
    try {
      const win = owner()
      const opts = { title: 'Save a decrypted copy', defaultPath: safeFileName(ref.name) }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return false
      await writeFile(r.filePath, data)
      return true
    } finally {
      data.fill(0)
    }
  })
  handle('attachments:open', async (id) => {
    const { ref, data } = await service.readAttachment(asString(id, 'Id'))
    try {
      if (!isOpenable(safeFileName(ref.name))) {
        throw new UserError('not-openable', `For safety, ${ref.name} cannot be opened directly. Use "Save a copy" instead.`)
      }
      const dir = join(openDir, randomUUID())
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const file = join(dir, safeFileName(ref.name))
      await writeFile(file, data, { mode: 0o600 })
      const err = await shell.openPath(file)
      if (err) throw new UserError('open-failed', `No app could open ${ref.name}`)
    } finally {
      data.fill(0)
    }
  })
  handle('sync:status', () => service.getSyncStatus())
  handle('sync:connect', (a) => {
    const x = (a ?? {}) as { url?: unknown; token?: unknown }
    return service.connectRemote(asString(x.url, 'Address'), asString(x.token, 'Token'))
  })
  handle('sync:now', () => service.syncNow())
  handle('sync:updateToken', (t) => service.updateToken(asString(t, 'Token')))
  handle('sync:disconnect', () => service.disconnectRemote())
  handle('entries:resolveConflict', (a) => {
    const x = (a ?? {}) as { id?: unknown; keepCopy?: unknown }
    return service.resolveConflict(asString(x.id, 'Id'), x.keepCopy === true)
  })
  handle('clipboard:copy', (text) => {
    const value = asString(text, 'Text')
    service.touch()
    clipboard.writeText(value)
    lastCopied = value
    clearTimeout(clipboardTimer)
    clipboardTimer = setTimeout(() => {
      void Promise.resolve(clipboard.readText()).then((current) => {
        if (current === value) clipboard.clear()
        if (lastCopied === value) lastCopied = null
      })
    }, CLIPBOARD_CLEAR_MS)
  })
}
