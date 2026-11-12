import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api'

export function Join({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (pw !== pw2) return setError('The passwords do not match')
    setBusy(true)
    try {
      await api.joinVault({ url, token, name, password: pw })
      onDone() // the app now shows the "waiting for approval" screen
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="card" onSubmit={(e) => void submit(e)}>
        <h1>Join the church vault</h1>
        <p className="hint">
          Ask an admin for the repository address and to add you to the church's GitHub organization. Then create your
          own fine-grained access token: resource owner the organization, only the vault repository, Contents: Read and
          write. Never use someone else's token. Details: the installation guide (docs/INSTALL.md).
        </p>
        <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label>Choose a password (at least 10 characters)<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>Repeat password<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        <label>Repository address<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/your-church/vault" /></label>
        <label>Access token<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="primary" disabled={busy}>{busy ? 'Connecting…' : 'Request access'}</button>
          <button type="button" onClick={onBack}>Back</button>
        </div>
      </form>
    </div>
  )
}
