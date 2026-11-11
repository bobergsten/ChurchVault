import { useState } from 'react'
import type { AttachmentPreview, AttachmentRef } from '@shared/entry'
import { api, errorMessage } from '../api'

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const PREVIEWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain', 'text/markdown', 'text/csv'])
const icon = (mime: string): string => (mime.startsWith('image/') ? '🖼️' : mime === 'application/pdf' ? '📕' : '📎')

/** Editable list inside the entry form. */
export function AttachmentEditor({ value, onChange }: { value: AttachmentRef[]; onChange: (v: AttachmentRef[]) => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    setError('')
    setBusy(true)
    try {
      const added = await api.pickAttachments()
      onChange([...value, ...added])
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="formrow">
      <span>Attachments</span>
      <ul className="attachments">
        {value.map((a) => (
          <li key={a.id}>
            <span>{icon(a.mime)} {a.name}</span>
            <span className="hint">{formatSize(a.size)}</span>
            <button type="button" onClick={() => onChange(value.filter((x) => x.id !== a.id))}>Remove</button>
          </li>
        ))}
      </ul>
      <span className="row">
        <button type="button" disabled={busy} onClick={() => void add()}>{busy ? 'Encrypting…' : 'Add files…'}</button>
        <span className="hint">Up to 25 MB per file. Files are encrypted before they are stored.</span>
      </span>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}

/** Read-only list in the entry view, with preview / open / save. */
export function AttachmentList({ items }: { items: AttachmentRef[] }) {
  const [preview, setPreview] = useState<{ ref: AttachmentRef; p: AttachmentPreview } | null>(null)
  const [error, setError] = useState('')

  const act = (fn: () => Promise<unknown>) => () => {
    setError('')
    fn().catch((e) => setError(errorMessage(e)))
  }

  if (items.length === 0) return null
  return (
    <div className="field">
      <div className="label">Attachments</div>
      <ul className="attachments">
        {items.map((a) => (
          <li key={a.id}>
            <span>{icon(a.mime)} {a.name}</span>
            <span className="hint">{formatSize(a.size)}</span>
            <span className="row">
              {PREVIEWABLE.has(a.mime) && (
                <button onClick={act(async () => setPreview({ ref: a, p: await api.previewAttachment(a.id) }))}>Preview</button>
              )}
              <button title="Opens a temporary decrypted copy, deleted when the vault locks" onClick={act(() => api.openAttachment(a.id))}>Open</button>
              <button onClick={act(() => api.saveAttachment(a.id))}>Save a copy…</button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="error" role="alert">{error}</p>}
      {preview && (
        <div className="overlay" role="dialog" aria-label={`Preview of ${preview.ref.name}`} onClick={() => setPreview(null)}>
          <div className="card preview" onClick={(e) => e.stopPropagation()}>
            <div className="row between"><strong>{preview.ref.name}</strong><button onClick={() => setPreview(null)}>Close</button></div>
            {preview.p.kind === 'image' && <img src={preview.p.dataUrl} alt={preview.ref.name} />}
            {preview.p.kind === 'text' && <pre>{preview.p.text}</pre>}
            {preview.p.kind === 'none' && <p className="hint">This file type cannot be shown here. Use Open or Save a copy.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
