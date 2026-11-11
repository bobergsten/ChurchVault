import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api'

export function Setup({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (pw !== pw2) return setError('The passwords do not match')
    setBusy(true)
    try {
      setRecoveryKey((await api.createVault({ name, password: pw })).recoveryKey)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (recoveryKey) {
    return (
      <div className="center">
        <div className="card">
          <h1>Save your recovery key</h1>
          <p>
            This key opens the vault if everyone forgets their password. It is shown <strong>only once</strong>. Print it
            and keep it somewhere safe, such as a locked drawer at the church office.
          </p>
          <pre className="recovery" data-testid="recovery-key">{recoveryKey}</pre>
          <div className="row">
            <button type="button" onClick={() => window.print()}>Print</button>
            <button type="button" onClick={() => void api.copy(recoveryKey)}>Copy</button>
          </div>
          <label className="check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            I have stored the recovery key safely
          </label>
          <button className="primary" disabled={!saved} onClick={onDone}>Continue</button>
        </div>
      </div>
    )
  }

  return (
    <div className="center">
      <form className="card" onSubmit={(e) => void submit(e)}>
        <h1>Create the church vault</h1>
        <p>Choose a strong password. It cannot be recovered without the recovery key.</p>
        <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label>Password (at least 10 characters)<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>Repeat password<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create vault'}</button>
      </form>
    </div>
  )
}
