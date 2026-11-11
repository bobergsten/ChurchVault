import { useEffect, useState, type FormEvent } from 'react'
import type { SyncStatus } from '@shared/api'
import { api, errorMessage } from '../api'

function ago(iso: string | null): string {
  if (!iso) return 'not yet'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  return `${Math.floor(s / 3600)} h ago`
}

function ConnectDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.connectRemote({ url, token })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="overlay" role="dialog" aria-label="Set up GitHub sync">
      <form className="card" onSubmit={(e) => void submit(e)}>
        <h1>Sync with GitHub</h1>
        <p className="hint">
          1. On github.com create a <strong>private</strong> repository (empty, no README).<br />
          2. Create a fine-grained access token limited to <em>only that repository</em> with <em>Contents: Read and write</em>.<br />
          3. Paste both below. Everything uploaded is encrypted; GitHub never sees your passwords.
        </p>
        <label>Repository address<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/your-church/vault" autoFocus /></label>
        <label>Access token<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="primary" disabled={busy || !url || !token}>{busy ? 'Connecting…' : 'Connect'}</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

export function SyncBar({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [dialog, setDialog] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    void api.getSyncStatus().then(setStatus)
    return api.onSyncStatus((s) => {
      setStatus((prev) => {
        if (prev?.syncing && !s.syncing) onSynced() // a sync finished: entries may have changed
        return s
      })
    })
  }, [onSynced])
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000) // keep "x min ago" fresh
    return () => clearInterval(t)
  }, [])

  if (!status) return null
  return (
    <>
      {!status.configured && <button onClick={() => setDialog(true)}>Set up GitHub sync</button>}
      {status.configured && (
        <span className="sync" title={status.remoteUrl ?? ''}>
          {status.syncing
            ? 'Syncing…'
            : status.lastError
              ? <span className="error" title={status.lastError.message}>⚠ {status.lastError.message}</span>
              : <>Synced {ago(status.lastSyncAt)}</>}
          <button disabled={status.syncing} onClick={() => void api.syncNow().then(setStatus).catch(() => undefined)}>Sync now</button>
          <button className="linklike" onClick={() => { if (window.confirm('Stop syncing with GitHub on this computer? Your data stays here and on GitHub.')) void api.disconnectRemote().then(setStatus) }}>Disconnect</button>
        </span>
      )}
      {dialog && <ConnectDialog onClose={() => setDialog(false)} />}
    </>
  )
}
