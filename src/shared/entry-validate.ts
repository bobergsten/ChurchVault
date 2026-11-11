import { ENTRY_ID_PATTERN, ENTRY_TYPES, FIELD_SPECS, type EntryInput, type EntryType } from './entry'

const MAX_TEXT = 100_000
const MAX_TAGS = 50
export const MAX_ATTACHMENTS = 20

function str(v: unknown, what: string): string {
  if (v === undefined || v === null || v === '') return ''
  if (typeof v !== 'string') throw new Error(`${what} must be text`)
  if (v.length > MAX_TEXT) throw new Error(`${what} is too long`)
  return v
}

/**
 * Validate and normalise untrusted input from the renderer. Unknown keys are
 * dropped, missing text fields become empty strings, optional empty fields are omitted.
 */
export function parseEntryInput(raw: unknown): EntryInput {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid entry')
  const r = raw as Record<string, unknown>
  const type = r.type as EntryType
  if (!ENTRY_TYPES.includes(type)) throw new Error('Unknown entry type')

  const title = str(r.title, 'Title').trim()
  if (!title) throw new Error('Title is required')

  const tags = Array.isArray(r.tags) ? r.tags : []
  if (tags.length > MAX_TAGS) throw new Error('Too many tags')
  const cleanTags = [...new Set(tags.map((t) => str(t, 'Tag').trim()).filter(Boolean))]

  const rawFields = (typeof r.fields === 'object' && r.fields !== null ? r.fields : {}) as Record<string, unknown>
  const fields: Record<string, string> = {}
  for (const spec of FIELD_SPECS[type]) {
    const v = str(rawFields[spec.key], spec.label)
    if (v !== '' || !spec.optional) fields[spec.key] = v
  }

  const attachments = Array.isArray(r.attachments) ? r.attachments : []
  if (attachments.length > MAX_ATTACHMENTS) throw new Error(`At most ${MAX_ATTACHMENTS} attachments per entry`)
  const cleanAttachments = attachments.map((a) => {
    const x = a as Record<string, unknown>
    if (typeof x?.id !== 'string' || !ENTRY_ID_PATTERN.test(x.id) || typeof x.name !== 'string' || typeof x.size !== 'number' || typeof x.mime !== 'string') {
      throw new Error('Invalid attachment')
    }
    const name = x.name.trim().slice(0, 255)
    if (!name) throw new Error('Attachment name is required')
    return { id: x.id, name, size: x.size, mime: x.mime }
  })
  if (new Set(cleanAttachments.map((a) => a.id)).size !== cleanAttachments.length) throw new Error('Duplicate attachment')

  return {
    type,
    title,
    tags: cleanTags,
    favorite: r.favorite === true,
    notes: str(r.notes, 'Notes'),
    attachments: cleanAttachments,
    fields
  } as EntryInput
}
