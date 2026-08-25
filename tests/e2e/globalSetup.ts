// tests/e2e/globalSetup.ts
//
// Refuse to run the browser e2e suite against the main Supabase project.
//
// The hazard is quiet. Locally Playwright boots the app with `npm run dev`,
// and `next dev` reads `.env.local` — which on a maintainer's machine points
// at the MAIN Supabase project, not the docker test database. Nothing in the
// run says so: the specs simply exercise real accounts, and every spec that
// writes (signup, booking, holds) writes there.
//
// `pnpm test:e2e:local` avoids it by layering `.env.e2e.local` first, and
// `booking-lifecycle.spec.ts` refuses the main project ref by hand. But that
// left the protection opt-in and single-spec: a bare `npx playwright test`
// skipped both. This makes the refusal apply to every spec, every entry point.
//
// Escape hatch, unchanged from the one booking-lifecycle already documented:
// E2E_ALLOW_MAIN_SUPABASE=true.
import fs from 'node:fs'
import path from 'node:path'

// Same ref booking-lifecycle.spec.ts and scripts/with-test-db.mjs refuse by
// name. Not a secret — it is the project id that appears in a connection URL.
const MAIN_PROJECT_REF = 'rqhhvuaoksuvbvlypztn'

function describeTarget(): string {
  const url = process.env.DATABASE_URL ?? ''
  if (!url) return '(DATABASE_URL not set in the Playwright process)'
  try {
    return new URL(url).host
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

export default function globalSetup(): void {
  if (process.env.E2E_ALLOW_MAIN_SUPABASE === 'true') {
    console.warn(
      '⚠️  E2E_ALLOW_MAIN_SUPABASE=true — running e2e against the main Supabase project on purpose.',
    )
    return
  }

  // An explicitly set DATABASE_URL decides it, because `next dev` does NOT
  // override a variable that is already in the environment — so the server
  // this run starts will inherit exactly this value and `.env.local` never
  // gets a say. `pnpm test:e2e:local` pins the docker test database this way,
  // and reading the file anyway would refuse the very workflow we recommend.
  const pinned = process.env.DATABASE_URL ?? process.env.DIRECT_URL ?? null

  const effective =
    pinned ??
    // Nothing pinned, so the server will resolve `.env.local` itself. Read the
    // file rather than the env: the guard has to catch the case where THIS
    // process is clean and the server it is about to talk to is not.
    readDatabaseUrlFromEnvFile('.env.local')

  if (!effective || !effective.includes(MAIN_PROJECT_REF)) return

  const viaEnvFile = pinned === null

  // Two different faults, so say which one happened. The webServer this config
  // starts is already pinned to the docker database, so an unpinned run is not
  // "the server is on production" — it is "nothing pinned it", which still
  // sinks any spec that opens its own Prisma client (booking-lifecycle seeds
  // and tears down through one) and any server this run did not start itself.
  const headline = viaEnvFile
    ? 'Refusing to run e2e without a pinned test database.'
    : 'Refusing to run e2e against the main Supabase project.'

  const cause = viaEnvFile
    ? [
        '  DATABASE_URL is not set for this run, and .env.local — the fallback',
        '  for anything that resolves its own env — points at the main Supabase',
        '  project. Specs that open a database connection would land there, as',
        '  would a dev server this run reused rather than started.',
      ]
    : [`  DATABASE_URL/DIRECT_URL point at it (${describeTarget()}).`]

  throw new Error(
    [
      '',
      headline,
      '',
      ...cause,
      '',
      '  Run:  pnpm test:e2e:local        (layers .env.e2e.local over .env.local)',
      '  Or set E2E_ALLOW_MAIN_SUPABASE=true if you really mean it.',
      '',
    ].join('\n'),
  )
}

function readDatabaseUrlFromEnvFile(file: string): string | null {
  const full = path.resolve(process.cwd(), file)
  if (!fs.existsSync(full)) return null

  for (const rawLine of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq === -1) continue
    if (line.slice(0, eq).trim() !== 'DATABASE_URL') continue

    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    return value
  }
  return null
}
