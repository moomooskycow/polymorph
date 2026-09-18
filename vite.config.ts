import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Copies the MV3 manifest and the bundled face SVGs into `dist/`.
 *
 * Vite hashes every other emitted asset; these two sets must keep stable
 * paths because the manifest and the README refer to them.
 */
function staticAssets(): Plugin {
  return {
    name: 'polymorph-static-assets',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: readFileSync(new URL('manifest.json', import.meta.url), 'utf8'),
      });
      for (const file of readdirSync(new URL('assets/faces/', import.meta.url))) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/faces/${file}`,
          source: readFileSync(new URL(`assets/faces/${file}`, import.meta.url)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [staticAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    rollupOptions: {
      input: {
        popup: 'popup.html',
        options: 'options.html',
        background: 'src/background.ts',
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});