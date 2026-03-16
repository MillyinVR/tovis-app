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

const child = spawnSync(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: directUrl,
  },
})

process.exit(child.status ?? 1)