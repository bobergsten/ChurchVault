import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { MemberInfo } from '@shared/api'
import { api, errorMessage } from '../api'
import { RecoveryKeyPanel } from './RecoveryKeyPanel'

function ChangePassword() {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    try {
      await api.changePassword({ oldPassword: oldPw, newPassword: newPw })
      setOldPw('')
      setNewPw('')
      setMsg({ ok: true, text: 'Password changed.' })
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) })
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="members-pw">
      <h3>Change my password</h3>
      <div className="row">
        <input type="password" placeholder="Current password" aria-label="Current password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
        <input type="password" placeholder="New password (10+ characters)" aria-label="New password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        <button disabled={!oldPw || !newPw}>Change</button>
      </div>
      {msg && <p className={msg.ok ? 'hint' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </form>
  )
}

export function MembersDialog({ onClose }: { onClose: () => void }) {
  const [members, setMembers] = useState<MemberInfo[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)

  const load = useCallback(() => void api.listMembers().then(setMembers).catch((e) => setError(errorMessage(e))), [])
  useEffect(load, [load])

  async function run(fn: () => Promise<void>) {
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
      load()
    }
  }

  const approve = (m: MemberInfo) =>
    window.confirm(
      `Approve ${m.name}?\n\nOnly continue if ${m.name} read out exactly this code to you:\n\n${m.fingerprint}\n\nIf it differs, someone else may be pretending to be ${m.name}.`
    ) && run(() => api.approveMember(m.id))

  const remove = (m: MemberInfo) => {
    const text = m.pending
      ? `Decline the request from ${m.name}?`
      : `Remove ${m.name}?\n\nThe vault key will be changed so ${m.name} cannot read anything new. But ${m.name} may already have seen the existing passwords, so change the important ones (bank, cards, door codes).\n\nAlso remove ${m.name} as a collaborator on GitHub.`
    if (!window.confirm(text)) return
    void run(async () => {
      const r = await api.removeMember(m.id)
      if (r.recoveryKey) setNewKey(r.recoveryKey)
    })
  }

  if (newKey) {
    return (
      <div className="overlay">
        <RecoveryKeyPanel
          recoveryKey={newKey}
          title="New recovery key"
          intro="The vault key was changed. The old recovery key no longer works, so replace the printed copy with this one."
          onDone={() => { setNewKey(null); load() }}
        />
      </div>
    )
  }

  return (
    <div className="overlay" role="dialog" aria-label="Members">
      <div className="card wide">
        <div className="row between"><h1>Members</h1><button onClick={onClose}>Close</button></div>
        <ul className="members">
          {members.map((m) => (
            <li key={m.id}>
              <div>
                <strong>{m.name}</strong> {m.isMe && <span className="tag">you</span>} {m.pending && <span className="badge">waiting for approval</span>}
                <div className="hint">Security code: <code>{m.fingerprint}</code></div>
              </div>
              <span className="row">
                {m.pending && <button className="primary" disabled={busy} onClick={() => void approve(m)}>Approve</button>}
                {!m.isMe && <button className="danger" disabled={busy} onClick={() => remove(m)}>{m.pending ? 'Decline' : 'Remove'}</button>}
              </span>
            </li>
          ))}
        </ul>
        <p className="hint">To add someone: they choose “Join an existing vault” on their computer, you add them as a collaborator on GitHub, then approve them here after checking their security code.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <ChangePassword />
      </div>
    </div>
  )
}
