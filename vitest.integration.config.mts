import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Integration suites share one database and several perform global
    // cleanup (deleteMany({})), so test files must not run concurrently.
    fileParallelism: false,
    include: ['tests/integration/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.claude/**',
    ],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Mirrors vitest.config.mts. `server-only` is a Next.js build-time marker
      // with no runtime implementation installed, so any integration test that
      // reaches a module importing it (e.g. lib/auth/verification.ts via the
      // signup suite) fails to resolve without this alias.
      'server-only': path.resolve(__dirname, 'test/mocks/server-only.ts'),
    },
  },
})