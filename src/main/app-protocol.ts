import { net, protocol } from 'electron'
import { extname, join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The UI is served from app://bundle/ instead of file://, so the page gets no
 * file-system privileges and the `grantFileProtocolExtraPrivileges` fuse can be
 * turned off. Only files inside the built renderer folder can be requested.
 */
export const APP_ORIGIN = 'app://bundle'

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/** Nothing may load or connect anywhere except our own bundle; images may also be data: URLs (attachment previews). */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join('; ')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
}

/** Resolve a request path to a file inside `root`, or null if it would escape it. */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const rel = normalize(decoded === '/' ? '/index.html' : decoded).replace(/^([/\\])+/, '')
  const full = join(root, rel)
  return full.startsWith(root.endsWith(sep) ? root : root + sep) ? full : null
}

/** Must run after the app is ready. */
export function handleAppScheme(rendererDir: string): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    const file = url.host === 'bundle' ? resolveInside(rendererDir, url.pathname) : null
    if (!file) return new Response('Not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(file).toString())
    if (!res.ok) return new Response('Not found', { status: 404 })
    const headers = new Headers({
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff'
    })
    return new Response(res.body, { status: 200, headers })
  })
}
