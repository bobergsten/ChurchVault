import sodium from 'libsodium-wrappers-sumo'

let ready: Promise<typeof sodium> | undefined

/** Resolves once libsodium has finished initialising. */
export function getSodium(): Promise<typeof sodium> {
  ready ??= sodium.ready.then(() => sodium)
  return ready
}

export class VaultError extends Error {
  constructor(
    readonly code:
      | 'wrong-password'
      | 'wrong-recovery-key'
      | 'bad-recovery-key'
      | 'invalid-kdf-params'
      | 'tampered'
      | 'pending-member'
      | 'stale-generation'
      | 'unsupported-format',
    message: string
  ) {
    super(message)
    this.name = 'VaultError'
  }
}
