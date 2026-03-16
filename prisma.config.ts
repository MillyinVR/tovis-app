// prisma.config.ts
import { defineConfig } from 'prisma/config'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Prefer an already-provided DATABASE_URL from the parent process.
 * This is how test commands can safely inject a separate database.
 *
 * Only fall back to loading local .env when DATABASE_URL is not already set.
 */
if (!process.env.DATABASE_URL) {
  const envPath = path.join(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

export default defineConfig({
  schema: './prisma/schema.prisma',
})