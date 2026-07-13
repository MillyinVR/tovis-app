// scripts/grant-super-admin.ts
//
// Grant a GLOBAL super-admin capability to an EXISTING user without changing
// their home role. Unlike scripts/create-super-admin.ts (which upserts a user
// and forces Role.ADMIN), this leaves `User.role` untouched — so a pro whose
// home workspace is PRO can hold a SUPER_ADMIN grant and switch into the Admin
// console via the workspace switcher (see lib/auth/workspaces.ts canActAs).
//
// Idempotent: re-running is a no-op once the global grant exists.
//
// Usage (prod uses the layered prod env, same as the load-test scripts):
//   dotenv -e .env.local -- tsx scripts/grant-super-admin.ts you@example.com
//   SUPER_ADMIN_GRANT_EMAIL=you@example.com dotenv -e .env.local -- tsx scripts/grant-super-admin.ts

import { PrismaClient } from '@prisma/client'
import { normalizeEmail } from '../app/api/_utils/email'
import { ensureGlobalSuperAdminPermission } from '../lib/adminPermissions'

const prisma = new PrismaClient()

async function main() {
  const raw = process.env.SUPER_ADMIN_GRANT_EMAIL ?? process.argv[2]
  const email = normalizeEmail(raw)
  if (!email) {
    throw new Error(
      'Target email required — pass it as the first argument or via SUPER_ADMIN_GRANT_EMAIL',
    )
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  })
  if (!user) {
    throw new Error(`No user found for ${email}; refusing to create one`)
  }

  const { created } = await ensureGlobalSuperAdminPermission(prisma, user.id)

  console.log(
    created
      ? 'Granted a global SUPER_ADMIN permission.'
      : 'User already held a global SUPER_ADMIN permission (no-op).',
  )
  console.log(`user: ${user.id}`)
  console.log(`home role (unchanged): ${user.role}`)
}

main()
  .catch((error) => {
    console.error('Failed to grant super admin:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
