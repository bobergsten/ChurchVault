import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/api'

const { autoUpdater } = electronUpdater

export const RELEASES_URL = 'https://github.com/bobergsten/ChurchVault/releases/latest'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/**
 * Updates come from this repository's GitHub Releases (see electron-builder.yml `publish`).
 * - Windows: downloaded in the background and installed on restart.
 * - macOS: unsigned apps cannot be replaced by the updater, so the user is told and gets a download link.
 * Only in packaged builds; never in development or tests.
 */
export function startUpdater(onStatus: (s: UpdateStatus) => void): {
  status: () => UpdateStatus
  install: (beforeQuit: () => void) => void
  openDownloadPage: () => void
} {
  let status: UpdateStatus = { state: 'none' }
  const set = (s: UpdateStatus): void => {
    status = s
    onStatus(s)
  }
  const enabled = app.isPackaged && !process.env['CHURCHVAULT_NO_UPDATES']
  const autoInstall = process.platform === 'win32'

  if (enabled) {
    autoUpdater.autoDownload = autoInstall
    autoUpdater.autoInstallOnAppQuit = autoInstall
    autoUpdater.logger = null // its log would go to a file; nothing secret, but keep the app quiet
    autoUpdater.on('update-available', (info) => {
      set(autoInstall ? { state: 'downloading', version: info.version } : { state: 'available', version: info.version })
    })
    autoUpdater.on('update-downloaded', (info) => set({ state: 'downloaded', version: info.version }))
    autoUpdater.on('error', () => {
      // Offline or GitHub unreachable: try again at the next check. Errors carry no secrets but are not shown.
    })
    const check = (): void => void autoUpdater.checkForUpdates().catch(() => undefined)
    setTimeout(check, 10_000)
    setInterval(check, CHECK_EVERY_MS)
  }

  return {
    status: () => status,
    install: (beforeQuit) => {
      if (status.state !== 'downloaded') return
      beforeQuit() // lock the vault and clear the clipboard first
      autoUpdater.quitAndInstall()
    },
    openDownloadPage: () => void shell.openExternal(RELEASES_URL)
  }
}
