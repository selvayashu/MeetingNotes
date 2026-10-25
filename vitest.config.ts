import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Component tests opt in with `// @vitest-environment jsdom`.
    // Many jsdom and in-process Postgres suites run at once; on a modest machine the 5 s default flakes under load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
