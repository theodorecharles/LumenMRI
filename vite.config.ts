import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const browserOnlyNodeShim = fileURLToPath(
  new URL('./src/shims/node-runtime-unavailable.ts', import.meta.url),
)

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/LumenMRI/' : '/',
  plugins: [react()],
  // The OpenJPEG Emscripten bundle contains dead Node-only require branches.
  // Resolving them explicitly avoids Vite's browser-external warning while
  // preserving an immediate failure if a Node-only path is ever reached.
  resolve: {
    alias: {
      fs: browserOnlyNodeShim,
      path: browserOnlyNodeShim,
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  worker: {
    format: 'es',
  },
})
