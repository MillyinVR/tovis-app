import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * The LIVE-MODEL suite. Separate config, separate directory, and deliberately
 * NOT reachable from `pnpm test`.
 *
 * Why it exists: every consult test mocks the provider, so the suite was fully
 * green while `runConsultAnalysis` could not make a single successful request —
 * its json_schema was refused by the Messages API, first for rejected keywords
 * and then for compiled-grammar size, and no mock can tell you that. These
 * tests send THE schema this repo would send to the real endpoint and check it
 * comes back 200 and parses.
 *
 * Why it is not in `pnpm test`: it costs money, needs ANTHROPIC_API_KEY, and
 * depends on a third party being up — three things a per-PR gate must not.
 * It runs nightly (.github/workflows/live-model-contract.yml) and on demand.
 *
 * No `vitest.setup.ts`: that file installs the global mocks this suite exists
 * to avoid.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/live/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.claude/**'],
    // One paid call at a time, and generous: these are real vision requests.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
    retry: 0,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'test/mocks/server-only.ts'),
    },
  },
})
