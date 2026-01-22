// lib/currentUser.ts
import { cookies } from 'next/headers'
import { verifyToken } from './auth'
import { prisma } from './prisma'

export async function getCurrentUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get('tovis_token')?.value
  if (!token) return null

  const payload = verifyToken(token)
  if (!payload?.userId) return null

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      role: true,

      clientProfile: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
        },
      },

      professionalProfile: {
        select: {
          id: true,
          businessName: true,
          handle: true,
          avatarUrl: true,
          timeZone: true,
          location: true,
        },
      },
    },
  })

  return user ?? null
}
