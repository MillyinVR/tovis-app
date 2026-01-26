// lib/messagesUnread.ts
import { prisma } from '@/lib/prisma'

export function clampSmallCount(n: number) {
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

/**
 * Unread threads for a user:
 * - user participates
 * - thread has lastMessageAt
 * - participant.lastReadAt is null OR older than lastMessageAt
 *
 * We compute in JS because Prisma can't safely do field-to-field comparisons.
 */
export async function getUnreadThreadCountForUser(userId: string) {
  if (!userId) return 0

  const threads = await prisma.messageThread.findMany({
    where: {
      participants: { some: { userId } },
      lastMessageAt: { not: null },
    },
    select: {
      lastMessageAt: true,
      participants: {
        where: { userId },
        select: { lastReadAt: true },
        take: 1,
      },
    },
    take: 500,
  })

  let unread = 0
  for (const t of threads) {
    const lastMessageAt = t.lastMessageAt
    const lastReadAt = t.participants?.[0]?.lastReadAt ?? null
    if (!lastMessageAt) continue
    if (!lastReadAt || lastReadAt < lastMessageAt) unread++
  }

  return unread
}
