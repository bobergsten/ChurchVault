import { useCallback, useEffect, useState } from 'react'
import type { EntrySummary, MemberSummary } from '@shared/api'
import { ENTRY_TYPES, TYPE_LABELS, type Entry, type EntryType } from '@shared/entry'
import { api, errorMessage } from '../api'
import { EntryDetail } from './EntryDetail'
import { EntryForm } from './EntryForm'
import { SyncBar } from './SyncBar'

type Pane = { kind: 'none' } | { kind: 'view'; entry: Entry } | { kind: 'edit'; type: EntryType; entry?: Entry }

const ICONS: Record<EntryType, string> = { login: '🔑', card: '💳', doorcode: '🚪', document: '📄', note: '📝' }

export function VaultView({ me, onLock }: { me: MemberSummary; onLock: () => void }) {
  const [type, setType] = useState<EntryType | undefined>()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<EntrySummary[]>([])
  const [pane, setPane] = useState<Pane>({ kind: 'none' })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      setRows(await api.listEntries({ type, query }))
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [type, query])

  useEffect(() => { void reload() }, [reload])

  async function open(id: string) {
    const entry = await api.getEntry(id)
    setPane(entry ? { kind: 'view', entry } : { kind: 'none' })
  }

  async function remove(entry: Entry) {
    if (!window.confirm(`Delete "${entry.title}"? This cannot be undone from the app.`)) return
    await api.deleteEntry(entry.id)
    setPane({ kind: 'none' })
    void reload()
  }

  async function resolve(entry: Entry, keepCopy: boolean) {
    try {
      await api.resolveConflict({ id: entry.id, keepCopy })
      setPane({ kind: 'none' })
      void reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="app">
      <header>
        <strong>ChurchVault</strong>
        <input className="search" type="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
        <span className="spacer" />
        <SyncBar onSynced={reload} />
        <span className="who">{me.name}</span>
        <button onClick={onLock}>Lock</button>
      </header>
      <div className="body">
        <nav>
          <button className={!type ? 'active' : ''} onClick={() => setType(undefined)}>All</button>
          {ENTRY_TYPES.map((t) => (
            <button key={t} className={type === t ? 'active' : ''} onClick={() => setType(t)}>{ICONS[t]} {TYPE_LABELS[t]}</button>
          ))}
        </nav>
        <section className="list">
          <div className="new">
            <button className="primary" onClick={() => setAdding(!adding)}>+ New</button>
            {adding && (
              <div className="menu">
                {ENTRY_TYPES.map((t) => (
                  <button key={t} onClick={() => { setAdding(false); setPane({ kind: 'edit', type: t }) }}>{ICONS[t]} {TYPE_LABELS[t]}</button>
                ))}
              </div>
            )}
          </div>
          {error && <p className="error">{error}</p>}
          {rows.length === 0 && <p className="hint pad">{query ? 'No matches.' : 'Nothing here yet.'}</p>}
          <ul>
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  className={pane.kind !== 'none' && 'entry' in pane && pane.entry?.id === r.id ? 'selected' : ''}
                  onClick={() => void open(r.id)}
                >
                  <span>{ICONS[r.type]}</span> <span className="t">{r.favorite && '★ '}{r.title}</span>{r.conflictOf && <span className="badge">⚠ Conflict</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <main>
          {pane.kind === 'none' && <p className="hint pad">Select an entry or create a new one.</p>}
          {pane.kind === 'view' && (
            <EntryDetail entry={pane.entry} onEdit={() => setPane({ kind: 'edit', type: pane.entry.type, entry: pane.entry })} onDelete={() => void remove(pane.entry)} onResolve={(keepCopy) => void resolve(pane.entry, keepCopy)} />
          )}
          {pane.kind === 'edit' && (
            <EntryForm
              key={pane.entry?.id ?? pane.type}
              type={pane.type}
              entry={pane.entry}
              onCancel={() => setPane(pane.entry ? { kind: 'view', entry: pane.entry } : { kind: 'none' })}
              onSaved={(e) => { setPane({ kind: 'view', entry: e }); void reload() }}
            />
          )}
        </main>
      </div>
    </div>
  )
}
