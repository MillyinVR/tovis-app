import { prisma } from '@/lib/prisma'

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      professionalProfile: {
        select: {
          id: true,
          businessName: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: 100,
  })

  console.log(JSON.stringify(users, null, 2))
}

main()
  .catch((error) => {
    console.error('Failed to look up booking override ids:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })