// Vite config for G0 demo entry.
// G0 only mounts a static SIMULATION banner and verifies the dev server starts.
// Real jsPsych timeline wiring belongs to agent B's experiment entry, not here.
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: 'src/ui',
  resolve: {
    alias: [
      {
        find: /^@contracts$/,
        replacement: fileURLToPath(new URL('./src/contracts/index.ts', import.meta.url)),
      },
      {
        find: /^@contracts\//,
        replacement: fileURLToPath(new URL('./src/contracts/', import.meta.url)),
      },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    open: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        status: fileURLToPath(new URL('./src/ui/index.html', import.meta.url)),
        preview: fileURLToPath(new URL('./src/ui/preview.html', import.meta.url)),
      },
    },
    outDir: '../../dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
  esbuild: {
    target: 'es2022',
  },
});
