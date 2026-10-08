import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The app's alias for the shared core, for tests of app/src/lib files that import it.
  resolve: { alias: { '@core': fileURLToPath(new URL('./supabase/functions/_shared/core', import.meta.url)) } },
  test: {
    // Integration tests need a local Supabase (`npx supabase start` + `functions serve`);
    // run them with `npm run test:int`.
    include: process.env.INTEGRATION ? ['tests/integration/**/*.test.ts'] : ['tests/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
