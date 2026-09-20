import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@contracts': fileURLToPath(new URL('./src/contracts/index.ts', import.meta.url)) },
  },
  build: {
    ssr: 'server/main.ts',
    target: 'node24',
    outDir: 'dist-server',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { output: { entryFileNames: 'main.js' } },
  },
});
