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
      createdAt: true,
      updatedAt: true,
      clientProfile: true,
      professionalProfile: true,
    },
  })

  return user ?? null
}
