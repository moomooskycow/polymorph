import { defineConfig } from 'vite';

/**
 * Content scripts cannot use ES module imports in MV3, so `content.ts` is
 * built separately as one self-contained IIFE. Shared chunks stay out of it.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    lib: {
      entry: 'src/content.ts',
      formats: ['iife'],
      name: 'Polymorph',
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: { extend: true },
    },
  },
});