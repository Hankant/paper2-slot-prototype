import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['handoffs/Q/g0-revision-review.spec.ts'],
  },
});
