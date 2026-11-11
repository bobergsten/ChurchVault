import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['src/**/*.test.ts'],
    // Multi-computer sync tests run real git processes, which are much slower on Windows runners.
    testTimeout: 30_000
  }
})
