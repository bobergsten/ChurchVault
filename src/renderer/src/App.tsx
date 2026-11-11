import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/api'

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.vault.getInfo().then(setInfo)
  }, [])
  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>ChurchVault</h1>
      {info && (
        <p>
          v{info.version} on {info.platform}
        </p>
      )}
    </main>
  )
}
