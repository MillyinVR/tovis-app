import { PrismaClient, Role, AdminPermissionRole } from '@prisma/client'
import { hashPassword } from '../lib/auth'
import { normalizeEmail } from '../app/api/_utils/email'

const prisma = new PrismaClient()

const DEFAULT_ADMIN_EMAIL = 'admin@tovis.app'

function requireNormalizedEmail(value: unknown, label = 'email'): string {
  const email = normalizeEmail(value)
  if (!email) {
    throw new Error(`Invalid ${label}`)
  }
  return email
}

async function main() {
  const email = requireNormalizedEmail(
    process.env.ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL,
    'ADMIN_EMAIL',
  )
  const rawPassword = process.env.ADMIN_PASSWORD
  if (!rawPassword || rawPassword.length < 12) {
    throw new Error(
      'ADMIN_PASSWORD must be set to at least 12 characters; refusing to create an admin with a default or weak password',
    )
  }
  const hashedPassword = await hashPassword(rawPassword)

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      email,
      password: hashedPassword,
      role: Role.ADMIN,
    },
    create: {
      email,
      password: hashedPassword,
      role: Role.ADMIN,
    },
    select: {
      id: true,
      email: true,
      role: true,
    },
  })

  const existingSuperAdmin = await prisma.adminPermission.findFirst({
    where: {
      adminUserId: user.id,
      role: AdminPermissionRole.SUPER_ADMIN,
      professionalId: null,
      serviceId: null,
      categoryId: null,
    },
    select: { id: true },
  })

  if (!existingSuperAdmin) {
    await prisma.adminPermission.create({
      data: {
        adminUserId: user.id,
        role: AdminPermissionRole.SUPER_ADMIN,
        professionalId: null,
        serviceId: null,
        categoryId: null,
      },
    })
  }

  console.log('Super admin ensured:')
  console.log(`email: ${user.email}`)
  console.log(`role: ${user.role}`)
}

main()
  .catch((error) => {
    console.error('Failed to create super admin:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })