import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest'
import { resolve } from 'node:path'

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    build: {
      emptyOutDir: true,
      outDir: 'build',
      rollupOptions: {
        input: {
          'mvt-tiles-panel': resolve(__dirname, 'mvt-tiles-panel.html'),
        },
        output: {
          chunkFileNames: 'assets/chunk-[hash].js',
        },
      },
    },

    plugins: [crx({ manifest })],
    legacy: {
      skipWebSocketTokenCheck: true,
    },
  }
})
