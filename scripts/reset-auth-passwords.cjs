const path = require('path')
require('dotenv').config({ path: path.join(process.cwd(), '.env') })

const bcrypt = require('bcrypt')
const { PrismaClient, Role } = require('@prisma/client')

const prisma = new PrismaClient()

const TARGET_PASSWORD = process.env.AUTH_RESET_PASSWORD || 'password123'
const TARGET_EMAILS = {
  client: process.env.AUTH_RESET_CLIENT_EMAIL || 'client@test.com',
  pro: process.env.AUTH_RESET_PRO_EMAIL || 'pro@test.com',
  admin: process.env.AUTH_RESET_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@test.com',
}

async function resetPassword(email, role, passwordHash) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true },
  })

  if (!user) {
    console.warn(`[skip] No user found for ${email}`)
    return
  }

  await prisma.user.update({
    where: { email },
    data: {
      password: passwordHash,
      role,
    },
  })

  console.log(`[ok] Updated ${role} password for ${email}`)
}

async function main() {
  console.log('Using DATABASE_URL:', process.env.DATABASE_URL || '(missing)')
  console.log('Resetting auth passwords to one shared value for:')
  console.log(TARGET_EMAILS)

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing')
  }

  const passwordHash = await bcrypt.hash(TARGET_PASSWORD, 10)

  await resetPassword(TARGET_EMAILS.client, Role.CLIENT, passwordHash)
  await resetPassword(TARGET_EMAILS.pro, Role.PRO, passwordHash)
  await resetPassword(TARGET_EMAILS.admin, Role.ADMIN, passwordHash)

  console.log('\nDone.')
  console.log(`Shared password is now: ${TARGET_PASSWORD}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
