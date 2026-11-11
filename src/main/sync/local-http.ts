/**
 * Test-only Git smart-HTTP "server": speaks the protocol by running the system
 * `git upload-pack` / `git receive-pack` against bare repositories on disk, so
 * sync can be tested end to end without a network.
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { HttpClient } from 'isomorphic-git'

async function collect(body: AsyncIterableIterator<Uint8Array> | undefined): Promise<Buffer> {
  const parts: Buffer[] = []
  if (body) for await (const c of body) parts.push(Buffer.from(c))
  return Buffer.concat(parts)
}

function run(args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn('git', args)
    const out: Buffer[] = []
    const err: Buffer[] = []
    p.stdout.on('data', (d: Buffer) => out.push(d))
    p.stderr.on('data', (d: Buffer) => err.push(d))
    p.on('error', reject)
    p.on('close', (code) => {
      // Fail loudly with git's own message instead of handing the client a truncated response.
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`git ${args[0]} exited with ${code}: ${Buffer.concat(err).toString('utf8').trim()}`))
    })
    p.stdin.end(input)
  })
}

const pkt = (s: string): string => (s.length + 4).toString(16).padStart(4, '0') + s

export interface LocalServer {
  http: HttpClient
  /** Requests seen, for assertions. */
  log: string[]
}

/** URLs look like `http://local/<repo>.git`, served from `<root>/<repo>.git`. Requires `Authorization` to carry `token`. */
export function localGitServer(
  root: string,
  token: string,
  /** Runs once, right before the first push is accepted: lets a test simulate someone else pushing first. */
  beforeFirstPush?: () => Promise<void>
): LocalServer {
  let hook = beforeFirstPush
  const log: string[] = []
  const http: HttpClient = {
    async request({ url, method = 'GET', headers = {}, body }) {
      const u = new URL(url)
      const m = /^\/(.+\.git)\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(u.pathname)
      const respond = (statusCode: number, data: Buffer, type = 'text/plain') => ({
        url,
        method,
        statusCode,
        statusMessage: String(statusCode),
        headers: { 'content-type': type },
        body: (async function* () {
          yield new Uint8Array(data)
        })()
      })
      log.push(`${method} ${u.pathname}${u.search}`)
      const expected = 'Basic ' + Buffer.from(`x-access-token:${token}`).toString('base64')
      const given = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1]
      if (given !== expected) return respond(401, Buffer.from('unauthorized'))
      if (!m) return respond(404, Buffer.from('not found'))
      const repo = join(root, m[1]!)
      const [, , what] = m
      if (what === 'info/refs') {
        const service = u.searchParams.get('service')!.replace('git-', '')
        const refs = await run([service, '--stateless-rpc', '--advertise-refs', repo])
        const head = Buffer.from(pkt(`# service=git-${service}\n`) + '0000')
        return respond(200, Buffer.concat([head, refs]), `application/x-git-${service}-advertisement`)
      }
      const service = what!.replace('git-', '')
      if (what === 'git-receive-pack' && hook) {
        const h = hook
        hook = undefined
        await h()
      }
      const out = await run([service, '--stateless-rpc', repo], await collect(body))
      return respond(200, out, `application/x-${what}-result`)
    }
  }
  return { http, log }
}
