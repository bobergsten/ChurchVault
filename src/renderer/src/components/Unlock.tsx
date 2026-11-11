import { useState, type FormEvent } from 'react'
import type { MemberSummary } from '@shared/api'
import { api, errorMessage } from '../api'

export function Unlock({ members, onUnlocked }: { members: MemberSummary[]; onUnlocked: () => void }) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? '')
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { unreadable } = await api.unlock({ memberId, password: pw })
      if (unreadable > 0) window.alert(`${unreadable} entries could not be read and were skipped.`)
      setPw('')
      onUnlocked()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="card" onSubmit={(e) => void submit(e)}>
        <h1>ChurchVault</h1>
        {members.length > 1 && (
          <label>
            Who are you?
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        {members.length === 1 && <p>Welcome back, {members[0]!.name}.</p>}
        <label>Password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy || !pw}>{busy ? 'Unlocking…' : 'Unlock'}</button>
      </form>
    </div>
  )
}
