import { useCallback, useEffect, useState } from 'react'
import type { VaultState } from '@shared/api'
import { api } from './api'
import { Setup } from './components/Setup'
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
  if (state.status === 'no-vault') return <Setup onDone={refresh} />
  if (state.status === 'locked') return <Unlock members={state.members} onUnlocked={refresh} />
  return <VaultView me={state.me} onLock={() => void api.lock().then(refresh)} />
}
