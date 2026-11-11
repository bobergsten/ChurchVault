import { useState } from 'react'
import { Join } from './Join'
import { Setup } from './Setup'

export function Welcome({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose')
  if (mode === 'create') return <Setup onDone={onDone} onBack={() => setMode('choose')} />
  if (mode === 'join') return <Join onDone={onDone} onBack={() => setMode('choose')} />
  return (
    <div className="center">
      <div className="card">
        <h1>ChurchVault</h1>
        <p>Shared, encrypted storage for the church’s passwords, cards, door codes and documents.</p>
        <button className="primary" onClick={() => setMode('create')}>Create a new vault</button>
        <p className="hint">First person only. Sets up the vault for everyone.</p>
        <button onClick={() => setMode('join')}>Join an existing vault</button>
        <p className="hint">The vault already exists and you were invited (needs the repository address and token).</p>
      </div>
    </div>
  )
}
