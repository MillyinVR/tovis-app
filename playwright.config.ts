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
  // Refuses to run against the main Supabase project — see the file's header.
  globalSetup: './tests/e2e/globalSetup.ts',
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
    // CI builds in its own workflow step (see e2e.yml / perf-availability.yml),
    // so this only boots the prebuilt server — a few seconds. `next build` used
    // to run here, which meant a ~2-4min production build of ~111 routes had to
    // finish inside the timeout below: on a slow runner it didn't, and the job
    // died with the opaque "Timed out waiting 120000ms from config.webServer"
    // having run zero tests (it took down `main` twice on 2026-07-16, once on a
    // docs-only commit). Any CI caller of `playwright test` MUST build first.
    //
    // Locally the server is started THROUGH the e2e env files. `next dev`
    // reads `.env.local`, which on a maintainer's machine points at the main
    // Supabase project, so a bare `npx playwright test` used to serve
    // production data to the suite. Layering `.env.e2e.local` first (exactly
    // what `pnpm test:e2e:local` does) makes every entry point safe, not just
    // that one. Running under `test:e2e:local` simply loads them twice, which
    // is a no-op — dotenv never overrides an already-set variable.
    command: isCI
      ? 'npm run start'
      : 'npx dotenv -e .env.e2e.local -e .env.local -- npm run dev',
    url: baseURL,
    timeout: 120_000,
    // Reuse is opt-in locally now. `reuseExistingServer: true` silently adopts
    // whatever is already on the port — typically a `pnpm dev` started with
    // `.env.local`, i.e. the production database — which defeats the env
    // layering above and is precisely what signup.spec.ts warns against ("do
    // NOT reuse a dev server that was started with .env.local"). Opt back in
    // with E2E_REUSE_DEV_SERVER=true when you know what your server is on.
    reuseExistingServer: !isCI && process.env.E2E_REUSE_DEV_SERVER === 'true',
  },
})