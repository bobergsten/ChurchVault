import { useState } from 'react'
import { api } from '../api'

/** Shows a recovery key once and makes the user confirm they stored it. */
export function RecoveryKeyPanel({ recoveryKey, onDone, title = 'Save your recovery key', intro }: {
  recoveryKey: string
  onDone: () => void
  title?: string
  intro?: string
}) {
  const [saved, setSaved] = useState(false)
  return (
    <div className="card">
      <h1>{title}</h1>
      <p>
        {intro ?? 'This key opens the vault if everyone forgets their password.'} It is shown <strong>only once</strong>. Print
        it and keep it somewhere safe, such as a locked drawer at the church office.
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
  )
}
