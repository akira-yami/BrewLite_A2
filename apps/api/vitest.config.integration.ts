import 'dotenv/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    include: ['test/integration/**/*.integration-spec.ts'],
    hookTimeout: 15000,
    testTimeout: 15000,
    fileParallelism: false,
  },
});
