import { useEffect, useState } from 'react'
import { FIELD_SPECS, type Entry } from '@shared/entry'
import { api } from '../api'

const REVEAL_MS = 20_000

function Field({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  // Re-mask secrets automatically.
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(false), REVEAL_MS)
    return () => clearTimeout(t)
  }, [shown])
  if (!value) return null
  return (
    <div className="field">
      <div className="label">{label}</div>
      <div className="row">
        <span className="value">{secret && !shown ? '••••••••••' : value}</span>
        {secret && <button onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</button>}
        <button onClick={() => void api.copy(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export function EntryDetail({ entry, onEdit, onDelete, onResolve }: {
  entry: Entry
  onEdit: () => void
  onDelete: () => void
  onResolve: (keepCopy: boolean) => void
}) {
  const fields = entry.fields as Record<string, string | undefined>
  return (
    <div className="detail">
      {entry.conflictOf && (
        <div className="banner" role="alert">
          <strong>Edit conflict.</strong> This entry was changed on two computers at the same time. This is the version that
          was <em>not</em> kept. Compare it with the other entry of the same name, then choose:
          <div className="row">
            <button onClick={() => onResolve(true)}>Use this version</button>
            <button onClick={() => onResolve(false)}>Discard this version</button>
          </div>
        </div>
      )}
      <div className="row between">
        <h2>{entry.favorite && '★ '}{entry.title}</h2>
        <span className="row"><button onClick={onEdit}>Edit</button><button className="danger" onClick={onDelete}>Delete</button></span>
      </div>
      {FIELD_SPECS[entry.type].map((s) => (
        <Field key={s.key} label={s.label} value={fields[s.key] ?? ''} secret={s.secret} />
      ))}
      {entry.notes && <div className="field"><div className="label">Notes</div><div className="notes">{entry.notes}</div></div>}
      {entry.tags.length > 0 && <div className="tags">{entry.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
      <p className="hint">Last changed {new Date(entry.updatedAt).toLocaleString()} (revision {entry.rev})</p>
    </div>
  )
}
