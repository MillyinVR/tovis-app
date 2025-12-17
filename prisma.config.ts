import { defineConfig } from 'prisma/config'
import process from 'node:process'

process.loadEnvFile()

export default defineConfig({
  schema: './prisma/schema.prisma',
})
