import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const envFile = path.resolve(process.cwd(), '.env.test.local')

if (!fs.existsSync(envFile)) {
  console.error('Missing .env.test.local')
  process.exit(1)
}

const parsed = {}
for (const rawLine of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue

  const eq = line.indexOf('=')
  if (eq === -1) continue

  const key = line.slice(0, eq).trim()
  let value = line.slice(eq + 1).trim()

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }

  parsed[key] = value
}

const databaseUrl = parsed.DATABASE_URL_TEST
const directUrl = parsed.DIRECT_URL_TEST ?? databaseUrl

if (!databaseUrl) {
  console.error('Missing DATABASE_URL_TEST in .env.test.local')
  process.exit(1)
}

if (!directUrl) {
  console.error('Missing DIRECT_URL_TEST in .env.test.local')
  process.exit(1)
}

const dangerousMainProjectRef = 'rqhhvuaoksuvbvlypztn'
const combined = `${databaseUrl} ${directUrl}`

if (combined.includes(dangerousMainProjectRef)) {
  console.error('Refusing to run against your main Supabase project.')
  process.exit(1)
}

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('No command provided to scripts/with-test-db.mjs')
  process.exit(1)
}

/**
 * Test-only PII keyring, mirroring what .github/workflows/integration.yml
 * exports for the CI run.
 *
 * Without it every suite that snapshots an address through the AEAD envelope
 * (a hold, a booking create, a reschedule) dies locally with
 * `Missing required env PII_AEAD_KEYS_JSON` while CI stays green — so the
 * local integration signal was permanently 16 tests short of the truth, and
 * each suite that hit it grew its own `vi.hoisted` shim to work around it.
 *
 * Set here rather than in `.env.test.local` because that file is gitignored:
 * a fix there would help one machine, this helps everyone. Never overrides an
 * already-set value (CI's real generated keys win), and it can only ever apply
 * to a process this wrapper launched against the local test database — the
 * prod-project guard above has already refused anything else.
 *
 * The keys are DERIVED, not written down: a literal base64 key here is
 * indistinguishable from a real one to a secret scanner (gitleaks flags it
 * `generic-api-key`, correctly — a scanner that learns to ignore this file is
 * worse than the inconvenience). Constructing them from a constant byte makes
 * them obviously fake by construction, and matches the `vi.hoisted` shim the
 * integration suites already use.
 *
 * These encrypt nothing but rows in a local `tovis_test` container.
 */
const testKeyBytes = (fill) => Buffer.alloc(32, fill).toString('base64')
const TEST_AEAD_KEY = testKeyBytes(9)
const TEST_HMAC_KEY = testKeyBytes(7)

const testPiiKeyring = {
  PII_AEAD_KEYS_JSON: JSON.stringify({
    'address-aead-v1': TEST_AEAD_KEY,
    'email-aead-v1': TEST_AEAD_KEY,
    'phone-aead-v1': TEST_AEAD_KEY,
    'notes-aead-v1': TEST_AEAD_KEY,
  }),
  PII_LOOKUP_HMAC_KEYS_JSON: JSON.stringify({ 1: TEST_HMAC_KEY }),
}

const child = spawnSync(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    // Defaults FIRST so a real environment value (CI's generated keyring)
    // always wins; everything else about the child env is unchanged.
    ...testPiiKeyring,
    ...process.env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: directUrl,
  },
})

process.exit(child.status ?? 1)