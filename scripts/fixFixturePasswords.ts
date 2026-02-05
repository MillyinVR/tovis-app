import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const PASSWORD = 'password123'
const EMAILS = ['admin@test.com', 'pro@test.com', 'client@test.com']

async function tryUpdatePassword(userId: string, passwordHash: string) {
  const attempts: Array<{ label: string; data: any }> = [
    { label: 'passwordHash', data: { passwordHash } },
    { label: 'hashedPassword', data: { hashedPassword: passwordHash } },
    { label: 'passwordDigest', data: { passwordDigest: passwordHash } },
    { label: 'password', data: { password: passwordHash } }, // sometimes teams store hash in "password" 🙃
  ]

  let lastErr: any = null

  for (const a of attempts) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: a.data,
      } as any)

      console.log(`✅ Updated password via ${a.label}`)
      return
    } catch (e: any) {
      lastErr = e
      // keep trying
    }
  }

  console.error('❌ Could not set a password field on User. None of the common fields matched.')
  throw lastErr
}

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 12)

  for (const email of EMAILS) {
    const u = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true },
    })

    if (!u) {
      console.log(`⚠️ Missing user: ${email}`)
      continue
    }

    console.log(`\nUser: ${u.email} (${u.role})`)
    await tryUpdatePassword(u.id, hash)
  }

  console.log('\n🎉 Done.')
  console.log('Try logging in with:')
  console.log(`  admin@test.com / ${PASSWORD}`)
  console.log(`  pro@test.com / ${PASSWORD}`)
  console.log(`  client@test.com / ${PASSWORD}`)
}

main()
  .catch((e) => {
    console.error('❌ fixFixturePasswords failed:', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
