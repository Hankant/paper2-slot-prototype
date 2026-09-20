// Vitest config for G0 contract + fixture tests.
// Browser-dependent tests live under tests/e2e (Playwright), not here.
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // node:sqlite is a Node 24 builtin that Vite 5's builtin list predates;
  // force SSR externalization so vitest passes the specifier through to Node.
  ssr: {
    external: ['node:sqlite'],
  },
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
  test: {
    globals: true,
    environment: 'jsdom',
    server: {
      deps: {
        external: ['node:sqlite'],
      },
    },
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    exclude: ['tests/e2e/**', 'tests/collection-e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/contracts/**', 'src/domain/**'],
      exclude: ['**/*.d.ts'],
    },
  },
});
