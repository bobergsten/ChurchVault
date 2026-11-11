/** Small encrypted key/value store for secrets that must outlive the app (the GitHub token). */
export interface SecretStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export class MemorySecretStore implements SecretStore {
  private readonly m = new Map<string, string>()
  async get(key: string): Promise<string | null> {
    return this.m.get(key) ?? null
  }
  async set(key: string, value: string): Promise<void> {
    this.m.set(key, value)
  }
  async delete(key: string): Promise<void> {
    this.m.delete(key)
  }
}
