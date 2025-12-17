import { cookies } from 'next/headers'
import { verifyToken } from './auth'
import { prisma } from './prisma'

export async function getCurrentUser() {
  // In Next 16, cookies() is async and returns a Promise<ReadonlyRequestCookies>
  const cookieStore = await cookies()
  const token = cookieStore.get('tovis_token')?.value

  if (!token) {
    return null
  }

  const payload = verifyToken(token)

  if (!payload) {
    return null
  }

  const db: any = prisma

  const user = await db.user.findUnique({
    where: { id: payload.userId },
    include: {
      clientProfile: true,
      professionalProfile: true,
    },
  })

  if (!user) {
    return null
  }

  return user
}
