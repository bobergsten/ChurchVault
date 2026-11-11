import { describe, expect, it } from 'vitest'
import type { AppInfo } from './api'

describe('AppInfo', () => {
  it('has the expected shape', () => {
    const info: AppInfo = { platform: 'linux', version: '0.1.0' }
    expect(info.version).toBe('0.1.0')
  })
})
