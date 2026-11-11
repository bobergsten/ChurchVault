import { useState, type FormEvent } from 'react'
import type { MemberSummary } from '@shared/api'
import { api, errorMessage } from '../api'

/** Forgotten password: reset it with the printed recovery key. */
export function Recover({ members, onDone, onBack }: { members: MemberSummary[]; onDone: () => void; onBack: () => void }) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? '')
  const [key, setKey] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (pw !== pw2) return setError('The passwords do not match')
    setBusy(true)
    try {
      await api.recoverAccess({ memberId, recoveryKey: key, newPassword: pw })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="card" onSubmit={(e) => void submit(e)}>
        <h1>Forgot your password?</h1>
        <p className="hint">Use the printed recovery key to choose a new password. Your entries are not affected.</p>
        {members.length > 1 && (
          <label>Who are you?
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        <label>Recovery key<input value={key} onChange={(e) => setKey(e.target.value)} autoFocus autoComplete="off" /></label>
        <label>New password (at least 10 characters)<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>Repeat new password<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="primary" disabled={busy || !key || !pw}>{busy ? 'Working…' : 'Reset password and unlock'}</button>
          <button type="button" onClick={onBack}>Back</button>
        </div>
      </form>
    </div>
  )
}
