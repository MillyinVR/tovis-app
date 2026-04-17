const path = require('path')
const dotenv = require('dotenv')

dotenv.config({ path: path.join(__dirname, '.env.local') })
dotenv.config({ path: path.join(__dirname, '.env') })

const { PrismaClient } = require('@prisma/client')
const bcryptjs = require('bcryptjs')

const prisma = new PrismaClient()

async function main() {
  const rawEmail = 'clientA@tovis.app'
  const normalizedEmail = rawEmail.trim().toLowerCase()
  const password = 'password123'

  const exactUser = await prisma.user.findUnique({
    where: { email: rawEmail },
    select: { id: true, email: true, role: true, password: true },
  })

  const normalizedUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true, role: true, password: true },
  })

  console.log({
    rawEmail,
    normalizedEmail,
    exactFound: !!exactUser,
    exactStoredEmail: exactUser?.email ?? null,
    normalizedFound: !!normalizedUser,
    normalizedStoredEmail: normalizedUser?.email ?? null,
  })

  if (exactUser) {
    const matches = await bcryptjs.compare(password, exactUser.password)
    console.log({
      exactUserPasswordMatches: matches,
      passwordHashPrefix: exactUser.password.slice(0, 20),
    })
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })