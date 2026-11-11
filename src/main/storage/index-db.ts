import Database from 'better-sqlite3-multiple-ciphers'
import { SECRET_FIELDS, type Entry, type EntryType } from '@shared/entry'

export interface IndexRow {
  id: string
  type: EntryType
  title: string
  tags: string[]
  favorite: boolean
  updatedAt: string
  updatedBy: string
  rev: number
  conflictOf?: string
}

/** Plain text used for full-text search: everything except secret values. */
export function searchText(entry: Entry): string {
  const secret = new Set(SECRET_FIELDS[entry.type])
  const fieldText = Object.entries(entry.fields as Record<string, unknown>)
    .filter(([k, v]) => !secret.has(k) && typeof v === 'string')
    .map(([, v]) => v as string)
  return [entry.notes, ...fieldText, ...entry.attachments.map((a) => a.name)].join('\n')
}

/** Turn user input into a safe FTS5 prefix query: every word must match, no operators. */
export function toFtsQuery(input: string): string | null {
  const words = input.match(/[\p{L}\p{N}]+/gu)
  return words ? words.map((w) => `"${w}"*`).join(' ') : null
}

const SCHEMA_VERSION = 2

/**
 * Local SQLCipher database: a disposable, searchable cache of the decrypted
 * entries. The repository files in Git stay the source of truth; this can always
 * be rebuilt from them.
 */
export class IndexDb {
  private constructor(private readonly db: Database.Database) {}

  /** Opens (creating if needed). Throws if `key` does not match an existing database. */
  static open(file: string, key: Uint8Array): IndexDb {
    const db = new Database(file)
    try {
      db.pragma("cipher='sqlcipher'")
      db.key(Buffer.from(key))
      db.pragma('journal_mode = WAL')
      db.pragma('secure_delete = ON')
      const index = new IndexDb(db)
      index.migrate()
      return index
    } catch (e) {
      db.close()
      throw e
    }
  }

  private migrate(): void {
    // The index is a disposable cache: on a schema change just start over and rebuild from the files.
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version < SCHEMA_VERSION) {
      this.db.exec('DROP TABLE IF EXISTS entries; DROP TABLE IF EXISTS entries_fts;')
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        tags TEXT NOT NULL,
        favorite INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        rev INTEGER NOT NULL,
        conflict_of TEXT,
        file_hash TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        id UNINDEXED, title, tags, body, tokenize = 'unicode61 remove_diacritics 2'
      );
    `)
  }

  upsert(entry: Entry, fileHash: string): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO entries (id, type, title, tags, favorite, updated_at, updated_by, rev, conflict_of, file_hash, data)
           VALUES (@id, @type, @title, @tags, @favorite, @updatedAt, @updatedBy, @rev, @conflictOf, @fileHash, @data)
           ON CONFLICT(id) DO UPDATE SET type=@type, title=@title, tags=@tags, favorite=@favorite,
             updated_at=@updatedAt, updated_by=@updatedBy, rev=@rev, conflict_of=@conflictOf, file_hash=@fileHash, data=@data`
        )
        .run({
          id: entry.id,
          type: entry.type,
          title: entry.title,
          tags: JSON.stringify(entry.tags),
          favorite: entry.favorite ? 1 : 0,
          updatedAt: entry.updatedAt,
          updatedBy: entry.updatedBy,
          rev: entry.rev,
          conflictOf: entry.conflictOf ?? null,
          fileHash,
          data: JSON.stringify(entry)
        })
      this.db.prepare('DELETE FROM entries_fts WHERE id = ?').run(entry.id)
      this.db
        .prepare('INSERT INTO entries_fts (id, title, tags, body) VALUES (?, ?, ?, ?)')
        .run(entry.id, entry.title, entry.tags.join(' '), searchText(entry))
    })
    tx()
  }

  remove(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM entries WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM entries_fts WHERE id = ?').run(id)
    })()
  }

  get(id: string): Entry | null {
    const row = this.db.prepare('SELECT data FROM entries WHERE id = ?').get(id) as { data: string } | undefined
    return row ? (JSON.parse(row.data) as Entry) : null
  }

  /** id -> content hash of the file that was indexed. */
  hashes(): Map<string, string> {
    const rows = this.db.prepare('SELECT id, file_hash FROM entries').all() as { id: string; file_hash: string }[]
    return new Map(rows.map((r) => [r.id, r.file_hash]))
  }

  list(opts: { type?: EntryType; query?: string } = {}): IndexRow[] {
    const where: string[] = []
    const params: unknown[] = []
    if (opts.type) {
      where.push('e.type = ?')
      params.push(opts.type)
    }
    let from = 'entries e'
    if (opts.query?.trim()) {
      const fts = toFtsQuery(opts.query)
      if (!fts) return []
      from = 'entries e JOIN entries_fts f ON f.id = e.id'
      where.push('entries_fts MATCH ?')
      params.push(fts)
    }
    const sql =
      `SELECT e.id, e.type, e.title, e.tags, e.favorite, e.updated_at, e.updated_by, e.rev, e.conflict_of FROM ${from}` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY e.favorite DESC, e.title COLLATE NOCASE ASC'
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as string,
      type: r.type as EntryType,
      title: r.title as string,
      tags: JSON.parse(r.tags as string) as string[],
      favorite: r.favorite === 1,
      updatedAt: r.updated_at as string,
      updatedBy: r.updated_by as string,
      rev: r.rev as number,
      ...(r.conflict_of ? { conflictOf: r.conflict_of as string } : {})
    }))
  }

  /** Every attachment id referenced by any entry (used before deleting blob files). */
  referencedBlobIds(): Set<string> {
    const rows = this.db.prepare('SELECT data FROM entries').all() as { data: string }[]
    const ids = new Set<string>()
    for (const r of rows) for (const a of (JSON.parse(r.data) as Entry).attachments) ids.add(a.id)
    return ids
  }

  clear(): void {
    this.db.exec('DELETE FROM entries; DELETE FROM entries_fts;')
  }

  close(): void {
    this.db.close()
  }
}
