import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Copies the MV3 manifest and the icon source into `dist/`. PNG icons arrive
 * through `public/`, produced by scripts/build-icons.mjs before Vite runs.
 * User replacement media lives in IndexedDB, never in the package.
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
      this.emitFile({
        type: 'asset',
        fileName: 'assets/icons/polymorph.svg',
        source: readFileSync(new URL('assets/icons/polymorph.svg', import.meta.url)),
      });
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