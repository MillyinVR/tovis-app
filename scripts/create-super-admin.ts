// scripts/create-super-admin.ts
import { PrismaClient, Role, AdminPermissionRole } from '@prisma/client'
import { hashPassword } from '../lib/auth'

const prisma = new PrismaClient()

async function main() {
  const email = 'admin@test.com'
  const rawPassword = 'password123'
  const hashedPassword = await hashPassword(rawPassword)

  const user = await prisma.user.upsert({
    where: { email },
    update: {
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
  console.log(`email: ${email}`)
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