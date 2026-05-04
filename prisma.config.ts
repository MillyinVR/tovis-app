// prisma.config.ts
import { defineConfig } from 'prisma/config'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Prisma does not automatically load .env.local when prisma.config.ts is used.
 *
 * Load local env files for local development, while preserving any DATABASE_URL
 * or DIRECT_URL already provided by the parent process. This keeps test/CI
 * database injection safe.
 *
 * Precedence:
 * 1. Parent process env vars
 * 2. .env.local
 * 3. .env
 */
const parentDatabaseUrl = process.env.DATABASE_URL
const parentDirectUrl = process.env.DIRECT_URL

for (const filename of ['.env', '.env.local'] as const) {
  const envPath = path.join(process.cwd(), filename)

  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

if (parentDatabaseUrl !== undefined) {
  process.env.DATABASE_URL = parentDatabaseUrl
}

if (parentDirectUrl !== undefined) {
  process.env.DIRECT_URL = parentDirectUrl
}

export default defineConfig({
  schema: './prisma/schema.prisma',
})