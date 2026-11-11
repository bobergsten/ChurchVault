import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: {}, protocol: {} }))
const { resolveInside } = await import('./app-protocol')

describe('app:// path resolution', () => {
  const root = join('/opt', 'app', 'renderer')
  it('serves files inside the renderer folder', () => {
    expect(resolveInside(root, '/')).toBe(join(root, 'index.html'))
    expect(resolveInside(root, '/assets/index-abc.js')).toBe(join(root, 'assets', 'index-abc.js'))
  })
  it('never resolves outside it', () => {
    for (const p of ['/../secrets.json', '/assets/../../x', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fx', '/..%5c..%5cx', '/%00', '//etc/passwd']) {
      const r = resolveInside(root, p)
      if (r !== null) expect(r.startsWith(root + '/') || r.startsWith(root + '\\')).toBe(true)
    }
    expect(resolveInside(root, '/%E0%A4%A')).toBeNull() // malformed escape
  })
})
