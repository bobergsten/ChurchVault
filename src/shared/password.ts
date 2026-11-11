export interface PasswordOptions {
  length: number
  lower: boolean
  upper: boolean
  digits: boolean
  symbols: boolean
  /** leave out look-alike characters such as 0/O and 1/l/I */
  avoidAmbiguous: boolean
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: true
}

const AMBIGUOUS = new Set('0O1lI|`\'"')

function classes(o: PasswordOptions): string[] {
  const sets: string[] = []
  if (o.lower) sets.push('abcdefghijklmnopqrstuvwxyz')
  if (o.upper) sets.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  if (o.digits) sets.push('0123456789')
  if (o.symbols) sets.push('!@#$%^&*()-_=+[]{};:,.<>?/~')
  return o.avoidAmbiguous ? sets.map((s) => [...s].filter((c) => !AMBIGUOUS.has(c)).join('')) : sets
}

/** Uniform random integer in [0, max) without modulo bias. */
function randomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf)
  while (buf[0]! >= limit)
  return buf[0]! % max
}

/** Random password containing at least one character from every selected class. */
export function generatePassword(options: PasswordOptions = DEFAULT_PASSWORD_OPTIONS): string {
  const sets = classes(options)
  if (sets.length === 0) throw new Error('Select at least one character type')
  const length = Math.floor(options.length)
  if (length < sets.length || length > 256) throw new Error('Invalid password length')
  const all = sets.join('')
  const chars = sets.map((s) => s[randomInt(s.length)]!)
  while (chars.length < length) chars.push(all[randomInt(all.length)]!)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}
