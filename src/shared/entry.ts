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

/** Fields that are secret and therefore never put in the search index. */
export const SECRET_FIELDS: Record<EntryType, readonly string[]> = {
  login: ['password', 'totpSecret'],
  card: ['number', 'cvv', 'pin'],
  doorcode: ['code'],
  document: [],
  note: []
}
