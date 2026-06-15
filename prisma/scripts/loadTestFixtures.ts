// prisma/scripts/loadTestFixtures.ts
//
// Prints the load-test env values for a SEEDED target environment, so a deployed
// load proof doesn't require hand-querying the DB or hunting a session cookie.
//
// Run it with the TARGET environment's DATABASE_URL + JWT_SECRET loaded (the
// same secret the deployment uses, so the minted client cookie validates there):
//
//   dotenv -e .env.staging.local -- pnpm loadproof:fixtures
//   # or, against a freshly seeded local/staging DB:
//   pnpm loadproof:fixtures
//
// It resolves (from the seed fixtures — run `pnpm seed` against the target first):
//   LOAD_TEST_PROFESSIONAL_ID  — the seeded pro's ProfessionalProfile.id
//   LOAD_TEST_SERVICE_ID       — a Service the pro offers
//   LOAD_TEST_CLIENT_COOKIE    — a freshly minted tovis_token for the seeded client
//
// STAGING_BASE_URL is NOT derivable here — it's your deployed staging URL.

import { PrismaClient } from '@prisma/client'

import { createActiveToken } from '@/lib/auth'

const prisma = new PrismaClient()

const PRO_HANDLE = process.env.LOAD_TEST_PRO_HANDLE?.trim() || 'tovis-test-pro'
const CLIENT_EMAIL =
  process.env.LOAD_TEST_CLIENT_EMAIL?.trim() || 'client@tovis.app'

type SafeError = { name: string; message: string }

function safeError(error: unknown): SafeError {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'UnknownError', message: 'Unknown error' }
}

async function resolveProfessional(): Promise<{
  professionalId: string
  serviceId: string
}> {
  const professional = await prisma.professionalProfile.findFirst({
    where: { handle: PRO_HANDLE },
    select: {
      id: true,
      offerings: {
        where: { isActive: true },
        select: { serviceId: true },
        take: 1,
      },
    },
  })

  if (!professional) {
    throw new Error(
      `No ProfessionalProfile with handle "${PRO_HANDLE}". Seed the target DB first (pnpm seed), or set LOAD_TEST_PRO_HANDLE.`,
    )
  }

  const serviceId = professional.offerings[0]?.serviceId
  if (!serviceId) {
    throw new Error(
      `Pro "${PRO_HANDLE}" has no active service offering to load-test against.`,
    )
  }

  return { professionalId: professional.id, serviceId }
}

async function resolveClientCookie(): Promise<string> {
  const user = await prisma.user.findFirst({
    where: { email: CLIENT_EMAIL },
    select: { id: true, role: true, authVersion: true },
  })

  if (!user) {
    throw new Error(
      `No user with email "${CLIENT_EMAIL}". Seed the target DB first (pnpm seed), or set LOAD_TEST_CLIENT_EMAIL.`,
    )
  }

  // Mint the same ACTIVE session token the login route sets as the tovis_token
  // cookie. Requires JWT_SECRET to match the target deployment.
  const token = createActiveToken({
    userId: user.id,
    role: user.role,
    authVersion: user.authVersion,
  })

  return `tovis_token=${token}`
}

async function main() {
  const wantExport = process.argv.includes('--export')

  const { professionalId, serviceId } = await resolveProfessional()
  const clientCookie = await resolveClientCookie()

  const lines = [
    `LOAD_TEST_PROFESSIONAL_ID=${professionalId}`,
    `LOAD_TEST_SERVICE_ID=${serviceId}`,
    `LOAD_TEST_CLIENT_COOKIE=${clientCookie}`,
  ]

  const baseUrl = process.env.STAGING_BASE_URL?.trim()

  console.log('# Load-test fixtures (add to .env.local / .env.staging.local):')
  console.log('#')
  if (baseUrl) {
    console.log(`# STAGING_BASE_URL is set: ${baseUrl}`)
  } else {
    console.log(
      '# STAGING_BASE_URL is NOT set — add your deployed staging URL, e.g.',
    )
    console.log('# STAGING_BASE_URL=https://<your-staging-deploy>.vercel.app')
  }
  console.log('#')
  for (const line of lines) {
    console.log(wantExport ? `export ${line}` : line)
  }
}

main()
  .catch((error: unknown) => {
    console.error('loadTestFixtures failed', safeError(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
