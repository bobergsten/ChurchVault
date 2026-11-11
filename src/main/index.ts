import { app, BrowserWindow, Menu, powerMonitor, session, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import http from 'isomorphic-git/http/node'
import { APP_ORIGIN, handleAppScheme, registerAppScheme } from './app-protocol'
import { clearClipboardIfOurs, cleanOpenDir, registerIpc } from './ipc'
import { SafeStorageSecretStore } from './safe-storage'
import { VaultService } from './vault-service'

const IDLE_LOCK_MS = 5 * 60 * 1000

let mainWindow: BrowserWindow | undefined

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'ChurchVault',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      // The Linux spellchecker downloads dictionaries; notes may hold secrets. Not worth it.
      spellcheck: false,
      // Developer tools would expose the unlocked vault; only available when developing.
      devTools: !app.isPackaged
    }
  })
  mainWindow = win
  // Keep secrets out of screenshots, screen sharing and recordings (macOS and Windows).
  win.setContentProtection(true)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => (mainWindow = undefined))
  // Never navigate the app window or open new windows inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://github.com/')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html`)
  }
}

// Lets automated tests run against a throw-away profile.
if (process.env['CHURCHVAULT_USER_DATA']) app.setPath('userData', process.env['CHURCHVAULT_USER_DATA'])

registerAppScheme()

/** Minimal menu: no "Toggle Developer Tools" or reload in packaged builds; Edit keeps copy/paste shortcuts working on macOS. */
function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = []
  if (process.platform === 'darwin') template.push({ role: 'appMenu' })
  template.push({ label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] })
  if (!app.isPackaged) template.push({ role: 'viewMenu' })
  template.push({ role: 'windowMenu' })
  return Menu.buildFromTemplate(template)
}

// Belt and braces for every web contents, including any created unexpectedly.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    handleAppScheme(join(import.meta.dirname, '../renderer'))
    Menu.setApplicationMenu(buildMenu())
    // The app needs no camera, microphone, notifications, location, etc.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)

    const userData = app.getPath('userData')
    const repoDir = join(userData, 'vault-repo')
    const dataDir = join(userData, 'local')
    mkdirSync(dataDir, { recursive: true })
    const openDir = join(dataDir, 'open')
    void cleanOpenDir(openDir)

    const service = new VaultService({
      repoDir,
      dataDir,
      idleMs: IDLE_LOCK_MS,
      http,
      secrets: new SafeStorageSecretStore(join(dataDir, 'secrets.json')),
      autoSync: true,
      onSyncStatus: (status) => mainWindow?.webContents.send('sync:status', status),
      onLocked: () => {
        void cleanOpenDir(openDir)
        void clearClipboardIfOurs()
        mainWindow?.webContents.send('vault:locked')
      }
    })
    registerIpc(service, {
      window: () => mainWindow?.webContents,
      info: () => ({ platform: process.platform, version: app.getVersion() }),
      openDir,
      // Only our own page may call in; in development that is the Vite dev server.
      origin: process.env['ELECTRON_RENDERER_URL'] ? new URL(process.env['ELECTRON_RENDERER_URL']).origin : APP_ORIGIN
    })
    powerMonitor.on('lock-screen', () => service.lock())
    powerMonitor.on('suspend', () => service.lock())
    app.on('before-quit', () => {
      service.lock()
      void clearClipboardIfOurs()
      // Synchronous, so temporary decrypted copies are gone before the process exits.
      try {
        rmSync(openDir, { recursive: true, force: true })
      } catch {
        // a file may still be held open by another app
      }
    })

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
