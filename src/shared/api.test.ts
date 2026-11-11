import { describe, expect, it } from 'vitest'
import { parseEntryInput } from './entry-validate'
import { DEFAULT_PASSWORD_OPTIONS, generatePassword } from './password'
import { SECRET_FIELDS } from './entry'

describe('parseEntryInput', () => {
  const base = { type: 'login', title: ' Bank ', tags: ['a', 'a', ' b ', ''], favorite: true, notes: 'n', attachments: [] }

  it('normalises input and drops unknown keys', () => {
    const e = parseEntryInput({ ...base, evil: 1, fields: { url: 'u', username: 'x', password: 'p', totpSecret: '', junk: 'z' } })
    expect(e.title).toBe('Bank')
    expect(e.tags).toEqual(['a', 'b'])
    expect(e.fields).toEqual({ url: 'u', username: 'x', password: 'p' })
    expect('evil' in e).toBe(false)
  })

  it('fills missing required text fields with empty strings', () => {
    expect(parseEntryInput({ ...base, fields: {} }).fields).toEqual({ url: '', username: '', password: '' })
  })

  it('rejects bad input', () => {
    expect(() => parseEntryInput(null)).toThrow()
    expect(() => parseEntryInput({ ...base, type: 'nope' })).toThrow(/type/)
    expect(() => parseEntryInput({ ...base, title: '  ' })).toThrow(/Title/)
    expect(() => parseEntryInput({ ...base, fields: { url: 5 } })).toThrow(/text/)
    expect(() => parseEntryInput({ ...base, attachments: [{ id: 1 }] })).toThrow(/attachment/)
    expect(() => parseEntryInput({ ...base, notes: 'x'.repeat(200_000) })).toThrow(/long/)
  })
})

describe('SECRET_FIELDS', () => {
  it('is derived from the field specs', () => {
    expect(SECRET_FIELDS.login).toEqual(['password', 'totpSecret'])
    expect(SECRET_FIELDS.card).toEqual(['number', 'cvv', 'pin'])
    expect(SECRET_FIELDS.doorcode).toEqual(['code'])
  })
})

describe('generatePassword', () => {
  it('has the requested length and every selected class', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 8 })
      expect(p).toHaveLength(8)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[0-9]/)
      expect(p).toMatch(/[^a-zA-Z0-9]/)
    }
  })

  it('respects disabled classes and ambiguity filter', () => {
    const o = { ...DEFAULT_PASSWORD_OPTIONS, length: 200, symbols: false, upper: false }
    const p = generatePassword(o)
    expect(p).toMatch(/^[a-z0-9]+$/)
    expect(p).not.toMatch(/[0l1]/)
  })

  it('is not repeatable and validates options', () => {
    expect(generatePassword()).not.toBe(generatePassword())
    expect(() => generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, lower: false, upper: false, digits: false, symbols: false })).toThrow()
    expect(() => generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 2 })).toThrow()
    expect(() => generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 1000 })).toThrow()
  })
})
