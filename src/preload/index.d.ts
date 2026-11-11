import type { VaultApi } from '@shared/api'

declare global {
  interface Window {
    vault: VaultApi
  }
}
