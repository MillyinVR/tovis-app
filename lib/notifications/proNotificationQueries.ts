import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type { NotificationType } from '@prisma/client'

const proNotificationListSelect = {
  id: true,
  type: true,
  reason: true,
  priority: true,
  title: true,
  body: true,
  href: true,
  data: true,
  createdAt: true,
  seenAt: true,
  readAt: true,
  bookingId: true,
  reviewId: true,
} satisfies Prisma.NotificationSelect

export type ProNotificationListItem = Prisma.NotificationGetPayload<{
  select: typeof proNotificationListSelect
}>

type ListProNotificationsArgs = {
  professionalId: string
  take: number
  cursorId?: string | null
  type?: NotificationType | null
  unreadOnly?: boolean
}

function buildBaseWhere(args: {
  professionalId: string
  type?: NotificationType | null
  unreadOnly?: boolean
}): Prisma.NotificationWhereInput {
  const where: Prisma.NotificationWhereInput = {
    professionalId: args.professionalId,
    archivedAt: null,
  }

  if (args.type) {
    where.type = args.type
  }

  if (args.unreadOnly) {
    where.readAt = null
  }

  return where
}

async function loadCursorRow(args: {
  professionalId: string
  cursorId: string
}): Promise<{ id: string; createdAt: Date } | null> {
  return prisma.notification.findFirst({
    where: {
      id: args.cursorId,
      professionalId: args.professionalId,
      archivedAt: null,
    },
    select: {
      id: true,
      createdAt: true,
    },
  })
}

export async function listProNotifications(
  args: ListProNotificationsArgs,
): Promise<{
  items: ProNotificationListItem[]
  nextCursor: string | null
}> {
  const take = Math.max(1, Math.min(100, Math.trunc(args.take)))
  const baseWhere = buildBaseWhere({
    professionalId: args.professionalId,
    type: args.type ?? null,
    unreadOnly: args.unreadOnly ?? false,
  })

  let where: Prisma.NotificationWhereInput = baseWhere

  if (args.cursorId) {
    const cursorRow = await loadCursorRow({
      professionalId: args.professionalId,
      cursorId: args.cursorId,
    })

    if (cursorRow) {
      where = {
        AND: [
          baseWhere,
          {
            OR: [
              {
                createdAt: {
                  lt: cursorRow.createdAt,
                },
              },
              {
                createdAt: cursorRow.createdAt,
                id: {
                  lt: cursorRow.id,
                },
              },
            ],
          },
        ],
      }
    }
  }

  const rows = await prisma.notification.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    select: proNotificationListSelect,
  })

  const hasMore = rows.length > take
  const items = hasMore ? rows.slice(0, take) : rows
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null

  return {
    items,
    nextCursor,
  }
}

export async function getProNotificationSummary(args: {
  professionalId: string
}): Promise<{
  hasUnread: boolean
  count: number
}> {
  const count = await prisma.notification.count({
    where: {
      professionalId: args.professionalId,
      archivedAt: null,
      readAt: null,
    },
  })

  return {
    hasUnread: count > 0,
    count,
  }
}

export async function markProNotificationRead(args: {
  professionalId: string
  notificationId: string
}): Promise<boolean> {
  const now = new Date()

  const updated = await prisma.notification.updateMany({
    where: {
      id: args.notificationId,
      professionalId: args.professionalId,
      archivedAt: null,
    },
    data: {
      seenAt: now,
      readAt: now,
    },
  })

  return updated.count === 1
}

export async function markAllProNotificationsRead(args: {
  professionalId: string
}): Promise<{
  count: number
}> {
  const now = new Date()

  const updated = await prisma.notification.updateMany({
    where: {
      professionalId: args.professionalId,
      archivedAt: null,
      readAt: null,
    },
    data: {
      seenAt: now,
      readAt: now,
    },
  })

  return {
    count: updated.count,
  }
}