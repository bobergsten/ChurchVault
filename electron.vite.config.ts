import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: { resolve: { alias } },
  preload: {
    resolve: { alias },
    // Sandboxed preload scripts must be CommonJS.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: { resolve: { alias }, plugins: [react()] }
})
