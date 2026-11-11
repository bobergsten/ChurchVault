import { useState } from 'react'
import type { MemberSummary } from '@shared/api'
import { api, errorMessage } from '../api'

export function Pending({ member, fingerprint, onChange }: { member: MemberSummary; fingerprint: string; onChange: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function check() {
    setError('')
    setBusy(true)
    try {
      await api.checkApproval()
      onChange()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <div className="card">
        <h1>Waiting for approval</h1>
        <p>Thanks, {member.name}. An existing member must approve you before you can open the vault.</p>
        <p>Tell them this security code (by phone or in person, not by e-mail), so they can check it matches:</p>
        <pre className="recovery" data-testid="fingerprint">{fingerprint}</pre>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy} onClick={() => void check()}>{busy ? 'Checking…' : 'Check if I have been approved'}</button>
      </div>
    </div>
  )
}
