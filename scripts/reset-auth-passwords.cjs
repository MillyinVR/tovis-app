const path = require('path')
const { loadEnvConfig } = require('@next/env')

loadEnvConfig(process.cwd())

const bcrypt = require('bcrypt')
const { PrismaClient, Role } = require('@prisma/client')

const prisma = new PrismaClient()

const TARGET_PASSWORD = process.env.AUTH_RESET_PASSWORD || 'password123'

function normalizeEmail(value) {
  if (typeof value !== 'string') return null

  const email = value.trim().toLowerCase()
  if (!email) return null
  if (!email.includes('@')) return null

  return email
}

function requireNormalizedEmail(value, label) {
  const email = normalizeEmail(value)
  if (!email) {
    throw new Error(`Invalid ${label}`)
  }
  return email
}

const TARGET_EMAILS = {
  client: requireNormalizedEmail(
    process.env.AUTH_RESET_CLIENT_EMAIL || 'client@tovis.app',
    'AUTH_RESET_CLIENT_EMAIL',
  ),
  pro: requireNormalizedEmail(
    process.env.AUTH_RESET_PRO_EMAIL || 'pro@tovis.app',
    'AUTH_RESET_PRO_EMAIL',
  ),
  admin: requireNormalizedEmail(
    process.env.AUTH_RESET_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@tovis.app',
    'AUTH_RESET_ADMIN_EMAIL',
  ),
}

async function findUserByEmailInsensitive(email) {
  return prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      email: true,
      role: true,
    },
  })
}

async function resetPassword(email, role, passwordHash) {
  const normalizedEmail = requireNormalizedEmail(email, `${role} email`)

  const user = await findUserByEmailInsensitive(normalizedEmail)

  if (!user) {
    console.warn(`[skip] No user found for ${normalizedEmail}`)
    return
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      email: normalizedEmail,
      password: passwordHash,
      role,
    },
  })

  const emailChanged = user.email !== normalizedEmail
  console.log(
    `[ok] Updated ${role} password for ${user.email}${emailChanged ? ` -> ${normalizedEmail}` : ''}`,
  )
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