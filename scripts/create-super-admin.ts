import { PrismaClient, Role, AdminPermissionRole } from '@prisma/client'
import { hashPassword } from '../lib/auth'
import { normalizeEmail } from '../app/api/_utils/email'

const prisma = new PrismaClient()

const DEFAULT_ADMIN_EMAIL = 'admin@tovis.app'
const DEFAULT_ADMIN_PASSWORD = 'password123'

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
  const rawPassword = process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD
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
  console.log(`password: ${rawPassword}`)
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