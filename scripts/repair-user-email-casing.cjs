const path = require('path')
const { loadEnvConfig } = require('@next/env')
const { PrismaClient } = require('@prisma/client')

loadEnvConfig(process.cwd())

const prisma = new PrismaClient()

function normalizeEmail(value) {
  if (typeof value !== 'string') return null

  const email = value.trim().toLowerCase()
  if (!email) return null
  if (!email.includes('@')) return null

  return email
}

function parseArgs(argv) {
  const flags = new Set(argv.slice(2))
  return {
    apply: flags.has('--apply'),
    verbose: flags.has('--verbose'),
  }
}

async function main() {
  const { apply, verbose } = parseArgs(process.argv)

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing')
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
    },
    orderBy: {
      email: 'asc',
    },
  })

  const invalidUsers = []
  const updates = []
  const buckets = new Map()

  for (const user of users) {
    const normalizedEmail = normalizeEmail(user.email)

    if (!normalizedEmail) {
      invalidUsers.push(user)
      continue
    }

    const bucket = buckets.get(normalizedEmail) ?? []
    bucket.push(user)
    buckets.set(normalizedEmail, bucket)

    if (user.email !== normalizedEmail) {
      updates.push({
        id: user.id,
        from: user.email,
        to: normalizedEmail,
        role: user.role,
      })
    }
  }

  const collisions = []
  for (const [normalizedEmail, bucket] of buckets.entries()) {
    if (bucket.length > 1) {
      collisions.push({
        normalizedEmail,
        users: bucket.map((user) => ({
          id: user.id,
          email: user.email,
          role: user.role,
        })),
      })
    }
  }

  console.log(`Scanned ${users.length} user(s)`)
  console.log(`Invalid email row(s): ${invalidUsers.length}`)
  console.log(`Needs lowercase repair: ${updates.length}`)
  console.log(`Normalized-email collision group(s): ${collisions.length}`)

  if (invalidUsers.length > 0) {
    console.log('\nInvalid email rows:')
    for (const user of invalidUsers) {
      console.log(`- ${user.id} | ${JSON.stringify(user.email)} | ${user.role}`)
    }
  }

  if (collisions.length > 0) {
    console.log('\nCollision groups found. Resolve these manually before applying:')
    for (const collision of collisions) {
      console.log(`\nnormalized => ${collision.normalizedEmail}`)
      for (const user of collision.users) {
        console.log(`- ${user.id} | ${user.email} | ${user.role}`)
      }
    }

    throw new Error('Aborting because email collisions would violate uniqueness after normalization.')
  }

  if (updates.length === 0) {
    console.log('\nNo email casing repairs are needed.')
    return
  }

  console.log('\nPlanned updates:')
  for (const update of updates) {
    console.log(`- ${update.id} | ${update.role} | ${update.from} -> ${update.to}`)
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write changes.')
    return
  }

  for (const update of updates) {
    await prisma.user.update({
      where: { id: update.id },
      data: { email: update.to },
    })

    if (verbose) {
      console.log(`[ok] ${update.from} -> ${update.to}`)
    }
  }

  console.log(`\nApplied ${updates.length} email repair(s).`)
}

main()
  .catch((error) => {
    console.error('\nrepair-user-email-casing failed:')
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })