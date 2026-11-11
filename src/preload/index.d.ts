import type { RawVaultApi } from '@shared/api'

declare global {
  interface Window {
    vault: RawVaultApi
  }
}
