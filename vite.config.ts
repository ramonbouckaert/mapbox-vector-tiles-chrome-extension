import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest'
import { resolve } from 'node:path'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig(() => {
  return {
    build: {
      emptyOutDir: true,
      outDir: 'build',
      license: true,
      rollupOptions: {
        input: {
          'mvt-tiles-panel': resolve(__dirname, 'mvt-tiles-panel.html'),
        },
        output: {
          chunkFileNames: 'assets/chunk-[hash].js',
        },
      },
    },

    plugins: [
      crx({ manifest }),
      viteStaticCopy({
        targets: [
          { src: 'LICENSE', dest: '' },
        ],
      })
    ],
    legacy: {
      skipWebSocketTokenCheck: true,
    },
  }
})
