import { useCallback, useEffect, useState } from 'react'
import type { VaultState } from '@shared/api'
import { api } from './api'
import { Pending } from './components/Pending'
import { UpdateBanner } from './components/UpdateBanner'
import { Welcome } from './components/Welcome'
import { Unlock } from './components/Unlock'
import { VaultView } from './components/VaultView'

export function App() {
  const [state, setState] = useState<VaultState | null>(null)
  const refresh = useCallback(() => void api.getState().then(setState), [])

  useEffect(() => {
    refresh()
    return api.onLocked(refresh)
  }, [refresh])

  // Any user activity postpones the auto-lock (throttled).
  useEffect(() => {
    let last = 0
    const ping = (): void => {
      const now = Date.now()
      if (now - last > 5000) {
        last = now
        api.touch()
      }
    }
    const events = ['keydown', 'mousedown', 'mousemove', 'wheel'] as const
    events.forEach((e) => window.addEventListener(e, ping))
    return () => events.forEach((e) => window.removeEventListener(e, ping))
  }, [])

  if (!state) return null
  let screen
  if (state.status === 'no-vault') screen = <Welcome onDone={refresh} />
  else if (state.status === 'pending') screen = <Pending member={state.member} fingerprint={state.fingerprint} onChange={refresh} />
  else if (state.status === 'locked') screen = <Unlock members={state.members} onUnlocked={refresh} />
  else screen = <VaultView me={state.me} onLock={() => void api.lock().then(refresh)} />
  return (
    <div className="shell">
      <UpdateBanner />
      <div className="screen">{screen}</div>
    </div>
  )
}
