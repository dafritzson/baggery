import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests need a local Supabase (`npx supabase start` + `functions serve`);
    // run them with `npm run test:int`.
    include: process.env.INTEGRATION ? ['tests/integration/**/*.test.ts'] : ['tests/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
