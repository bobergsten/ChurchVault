import { useState, type FormEvent } from 'react'
import { FIELD_SPECS, TYPE_LABELS, type Entry, type EntryInput, type EntryType } from '@shared/entry'
import { api, errorMessage } from '../api'
import { PasswordGenerator } from './PasswordGenerator'

const SINGULAR: Record<EntryType, string> = { login: 'login', card: 'card', doorcode: 'door code', document: 'document', note: 'note' }

export function EntryForm({ type, entry, onSaved, onCancel }: {
  type: EntryType
  entry?: Entry
  onSaved: (e: Entry) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(entry?.title ?? '')
  const [tags, setTags] = useState(entry?.tags.join(', ') ?? '')
  const [favorite, setFavorite] = useState(entry?.favorite ?? false)
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [fields, setFields] = useState<Record<string, string>>({ ...((entry?.fields as Record<string, string>) ?? {}) })
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const [generatorFor, setGeneratorFor] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const input = {
        type, title, favorite, notes, fields,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        attachments: entry?.attachments ?? []
      } as EntryInput
      onSaved(await api.saveEntry({ id: entry?.id, input }))
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form className="detail form" onSubmit={(e) => void submit(e)}>
      <h2>{entry ? 'Edit' : 'New'} {SINGULAR[type]}</h2>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></label>
      {FIELD_SPECS[type].map((spec) => (
        <div key={spec.key} className="formrow">
          <label htmlFor={`f-${spec.key}`}>{spec.label}</label>
          {spec.multiline ? (
            <textarea id={`f-${spec.key}`} rows={3} value={fields[spec.key] ?? ''} onChange={(e) => setFields({ ...fields, [spec.key]: e.target.value })} />
          ) : (
            <span className="row">
              <input
                id={`f-${spec.key}`}
                type={spec.secret && !shown[spec.key] ? 'password' : 'text'}
                autoComplete="off"
                value={fields[spec.key] ?? ''}
                onChange={(e) => setFields({ ...fields, [spec.key]: e.target.value })}
              />
              {spec.secret && (
                <button type="button" onClick={() => setShown({ ...shown, [spec.key]: !shown[spec.key] })}>
                  {shown[spec.key] ? 'Hide' : 'Show'}
                </button>
              )}
              {type === 'login' && spec.key === 'password' && (
                <button type="button" onClick={() => setGeneratorFor(spec.key)}>Generate</button>
              )}
            </span>
          )}
          {generatorFor === spec.key && (
            <PasswordGenerator
              onClose={() => setGeneratorFor(null)}
              onUse={(pw) => {
                setFields({ ...fields, [spec.key]: pw })
                setShown({ ...shown, [spec.key]: true })
                setGeneratorFor(null)
              }}
            />
          )}
        </div>
      ))}
      <label>Notes<textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <label>Tags (comma separated)<input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />Favorite</label>
      {type === 'document' && <p className="hint">File attachments are coming in a later version. For now, use the notes field.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>Save</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
      <span hidden>{TYPE_LABELS[type]}</span>
    </form>
  )
}
