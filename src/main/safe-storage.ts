import { safeStorage } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { UserError } from './vault-service'
import type { SecretStore } from './secret-store'

/**
 * Secrets encrypted with the operating system's keychain (macOS Keychain,
 * Windows DPAPI) through Electron's safeStorage, kept in one small file.
 */
export class SafeStorageSecretStore implements SecretStore {
  constructor(private readonly file: string) {}

  private usable(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    // On Linux without a keyring Electron silently falls back to a fixed key, which is not protection.
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
  }

  private async load(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }

  private async save(data: Record<string, string>): Promise<void> {
    const tmp = this.file + '.tmp'
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 })
    await rename(tmp, this.file)
  }

  async get(key: string): Promise<string | null> {
    const v = (await this.load())[key]
    if (!v || !this.usable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(v, 'base64'))
    } catch {
      return null
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.usable()) throw new UserError('no-secure-storage', 'This computer has no secure place (keychain) to store the GitHub token')
    const data = await this.load()
    data[key] = safeStorage.encryptString(value).toString('base64')
    await this.save(data)
  }

  async delete(key: string): Promise<void> {
    const data = await this.load()
    delete data[key]
    await this.save(data)
  }
}
