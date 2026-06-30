import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI
const port = Number(process.env.PORT ?? 3000)
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
const clientAuthFile = path.join(
  process.cwd(),
  'playwright',
  '.auth',
  'client.json',
)

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.(spec|setup)\.ts/,
  // The availability perf sampler hammers the single shared `next start`
  // server for ~3min and wedges its connection pool, timing out the
  // functional specs that run immediately after it. It has its own dedicated
  // workflow (perf-availability.yml, which invokes it by explicit path), so
  // the functional e2e gate sets E2E_SKIP_PERF=1 to keep it out of this run.
  testIgnore: process.env.E2E_SKIP_PERF
    ? [/availability\.perf\.spec\.ts/]
    : [],
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  timeout: 60_000,

  expect: {
    // On CI the functional specs share a single `next start` server and the
    // heaviest spec ("booking lifecycle launch proof") drives it hard, so
    // assertions that poll the UI/DB occasionally need more than the snappy
    // local default before the server catches up.
    timeout: isCI ? 15_000 : 10_000,
  },

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // The single shared `next start` server (one Prisma pool) is momentarily
    // slow under the heaviest spec's request burst. The previous 15s/30s
    // ceilings are what surfaced as the intermittent post-merge
    // `apiRequestContext.{post,patch}: Timeout 15000ms` and
    // `page.goto: Timeout 30000ms` failures on the mobile-chrome run (which
    // only runs on `main`, so these only ever showed up post-merge). Give CI
    // real headroom; healthy runs never reach these ceilings so passing runs
    // are not slowed.
    actionTimeout: isCI ? 30_000 : 15_000,
    navigationTimeout: isCI ? 45_000 : 30_000,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: clientAuthFile,
      },
    },
    {
      name: 'mobile-chrome',
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        storageState: clientAuthFile,
      },
    },
  ],

  webServer: {
    command: isCI ? 'npm run build && npm run start' : 'npm run dev',
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !isCI,
  },
})