import { app, BrowserWindow, powerMonitor, shell } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { registerIpc } from './ipc'
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
      sandbox: true
    }
  })
  mainWindow = win
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => (mainWindow = undefined))
  // Never navigate the app window or open new windows inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

// Lets automated tests run against a throw-away profile.
if (process.env['CHURCHVAULT_USER_DATA']) app.setPath('userData', process.env['CHURCHVAULT_USER_DATA'])

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
    const userData = app.getPath('userData')
    const repoDir = join(userData, 'vault-repo')
    const dataDir = join(userData, 'local')
    mkdirSync(dataDir, { recursive: true })

    const service = new VaultService({
      repoDir,
      dataDir,
      idleMs: IDLE_LOCK_MS,
      onLocked: () => mainWindow?.webContents.send('vault:locked')
    })
    registerIpc(service, () => mainWindow?.webContents, () => ({ platform: process.platform, version: app.getVersion() }))
    powerMonitor.on('lock-screen', () => service.lock())
    powerMonitor.on('suspend', () => service.lock())
    app.on('before-quit', () => service.lock())

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
