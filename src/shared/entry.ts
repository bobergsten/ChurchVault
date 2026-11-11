/** Decrypted entry model. Only ever exists in memory and in the encrypted local index. */

export const ENTRY_TYPES = ['login', 'card', 'doorcode', 'document', 'note'] as const
export type EntryType = (typeof ENTRY_TYPES)[number]

export interface AttachmentRef {
  /** blob id (file name under blobs/) */
  id: string
  name: string
  size: number
  mime: string
}

export interface LoginFields {
  url: string
  username: string
  password: string
  /** otpauth secret, base32 */
  totpSecret?: string
}
export interface CardFields {
  holder: string
  number: string
  /** MM/YY */
  expiry: string
  cvv: string
  pin?: string
  billingAddress?: string
}
export interface DoorCodeFields {
  location: string
  code: string
  sharedWith?: string
  lastChanged?: string
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DocumentFields {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface NoteFields {}

export interface FieldsByType {
  login: LoginFields
  card: CardFields
  doorcode: DoorCodeFields
  document: DocumentFields
  note: NoteFields
}

interface EntryBase<T extends EntryType> {
  id: string
  type: T
  title: string
  tags: string[]
  favorite: boolean
  notes: string
  attachments: AttachmentRef[]
  fields: FieldsByType[T]
  createdAt: string
  updatedAt: string
  /** member id of the last editor */
  updatedBy: string
  /** incremented on each save; used to detect concurrent edits */
  rev: number
}

export type Entry = { [T in EntryType]: EntryBase<T> }[EntryType]

/** What the UI supplies when creating or editing; bookkeeping fields are filled in by the repository. */
export type EntryInput = { [T in EntryType]: Omit<EntryBase<T>, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'rev'> }[EntryType]

export const ENTRY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface FieldSpec {
  key: string
  label: string
  /** masked in the UI, never searchable */
  secret?: boolean
  multiline?: boolean
  optional?: boolean
}

/** Single source of truth for the per-type fields: used by validation, forms and the search index. */
export const FIELD_SPECS: Record<EntryType, FieldSpec[]> = {
  login: [
    { key: 'url', label: 'Website' },
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
    { key: 'totpSecret', label: 'One-time code secret (TOTP)', secret: true, optional: true }
  ],
  card: [
    { key: 'holder', label: 'Card holder' },
    { key: 'number', label: 'Card number', secret: true },
    { key: 'expiry', label: 'Expiry (MM/YY)' },
    { key: 'cvv', label: 'CVV', secret: true },
    { key: 'pin', label: 'PIN', secret: true, optional: true },
    { key: 'billingAddress', label: 'Billing address', multiline: true, optional: true }
  ],
  doorcode: [
    { key: 'location', label: 'Location' },
    { key: 'code', label: 'Code', secret: true },
    { key: 'sharedWith', label: 'Shared with', optional: true },
    { key: 'lastChanged', label: 'Last changed', optional: true }
  ],
  document: [],
  note: []
}

export const TYPE_LABELS: Record<EntryType, string> = {
  login: 'Logins',
  card: 'Cards',
  doorcode: 'Door codes',
  document: 'Documents',
  note: 'Notes'
}

/** Fields that are secret and therefore never put in the search index. */
export const SECRET_FIELDS: Record<EntryType, readonly string[]> = Object.fromEntries(
  ENTRY_TYPES.map((t) => [t, FIELD_SPECS[t].filter((f) => f.secret).map((f) => f.key)])
) as unknown as Record<EntryType, readonly string[]>
