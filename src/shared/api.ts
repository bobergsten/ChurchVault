export interface AppInfo {
  platform: string
  version: string
}

/** API exposed from the main process to the renderer through the preload script. */
export interface VaultApi {
  getInfo(): Promise<AppInfo>
}
