// prisma.config.ts
import { defineConfig } from 'prisma/config'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Vercel does NOT provide a .env file in the build container.
 * It injects environment variables via the platform.
 *
 * So: only load a local env file if it actually exists.
 */
const envPath = path.join(process.cwd(), '.env')
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath)
}

export default defineConfig({
  schema: './prisma/schema.prisma',
})
