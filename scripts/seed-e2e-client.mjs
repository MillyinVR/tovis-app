import bcrypt from 'bcrypt'
import { PrismaClient, Role } from '@prisma/client'

const prisma = new PrismaClient()

const email = 'client@tovis.app'
const password = 'password123'

async function main() {
  const passwordHash = await bcrypt.hash(password, 10)

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      password: passwordHash,
      role: Role.CLIENT,
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
    },
    create: {
      email,
      password: passwordHash,
      role: Role.CLIENT,
      phoneVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
    },
    select: {
      id: true,
      email: true,
      role: true,
      clientProfile: {
        select: { id: true },
      },
    },
  })

  const clientProfile =
    user.clientProfile ??
    (await prisma.clientProfile.create({
      data: {
        userId: user.id,
        firstName: 'Test',
        lastName: 'Client',
      },
      select: { id: true },
    }))

  console.log(
    `Seeded E2E client ${user.email} (${user.role}) with clientProfile ${clientProfile.id}`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })