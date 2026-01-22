// scripts/fixStepMinutes.cjs
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  // Update only locations still at 5-minute steps
  const res = await prisma.professionalLocation.updateMany({
    where: { stepMinutes: 5 },
    data: { stepMinutes: 30 },
  })

  console.log('✅ Updated ProfessionalLocation rows:', res.count)

  // Optional: print a quick sanity check
  const sample = await prisma.professionalLocation.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, stepMinutes: true, timeZone: true, isPrimary: true },
  })

  console.log('🔎 Sample latest locations:', sample)
}

main()
  .catch((e) => {
    console.error('❌ Failed:', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
