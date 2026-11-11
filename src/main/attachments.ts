import { extname } from 'node:path'
import type { AttachmentPreview } from '@shared/entry'

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.zip': 'application/zip'
}

export function mimeFor(fileName: string): string {
  return MIME[extname(fileName).toLowerCase()] ?? 'application/octet-stream'
}

/** Image types safe to show inline (no SVG: it can carry scripts). */
const INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const TEXT = new Set(['text/plain', 'text/markdown', 'text/csv'])
const MAX_TEXT_PREVIEW = 1024 * 1024

export function previewFor(mime: string, data: Uint8Array): AttachmentPreview {
  if (INLINE_IMAGES.has(mime)) return { kind: 'image', dataUrl: `data:${mime};base64,${Buffer.from(data).toString('base64')}` }
  if (TEXT.has(mime) && data.length <= MAX_TEXT_PREVIEW) {
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: false }).decode(data) }
  }
  return { kind: 'none' }
}

/** A file name that is safe to create on macOS and Windows (no folders, reserved characters or names). */
export function safeFileName(name: string): string {
  let n = name
    .replace(/[\\/]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 200)
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = '_' + n
  return n || 'attachment'
}
