// lib/notifications/adminNotificationQueries.ts
//
// Read/mark helpers for the admin notification inbox. Mirrors
// proNotificationQueries but keyed on the admin User (AdminNotification rows).

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

const adminNotificationListSelect = {
  id: true,
  eventKey: true,
  priority: true,
  title: true,
  body: true,
  href: true,
  data: true,
  createdAt: true,
  seenAt: true,
  readAt: true,
} satisfies Prisma.AdminNotificationSelect

export type AdminNotificationListItem = Prisma.AdminNotificationGetPayload<{
  select: typeof adminNotificationListSelect
}>

type ListAdminNotificationsArgs = {
  adminUserId: string
  take: number
  cursorId?: string | null
  unreadOnly?: boolean
}

function buildBaseWhere(args: {
  adminUserId: string
  unreadOnly?: boolean
}): Prisma.AdminNotificationWhereInput {
  const where: Prisma.AdminNotificationWhereInput = {
    adminUserId: args.adminUserId,
    archivedAt: null,
  }

  if (args.unreadOnly) {
    where.readAt = null
  }

  return where
}

async function loadCursorRow(args: {
  adminUserId: string
  cursorId: string
}): Promise<{ id: string; createdAt: Date } | null> {
  return prisma.adminNotification.findFirst({
    where: {
      id: args.cursorId,
      adminUserId: args.adminUserId,
      archivedAt: null,
    },
    select: {
      id: true,
      createdAt: true,
    },
  })
}

export async function listAdminNotifications(
  args: ListAdminNotificationsArgs,
): Promise<{
  items: AdminNotificationListItem[]
  nextCursor: string | null
}> {
  const take = Math.max(1, Math.min(100, Math.trunc(args.take)))
  const baseWhere = buildBaseWhere({
    adminUserId: args.adminUserId,
    unreadOnly: args.unreadOnly ?? false,
  })

  let where: Prisma.AdminNotificationWhereInput = baseWhere

  if (args.cursorId) {
    const cursorRow = await loadCursorRow({
      adminUserId: args.adminUserId,
      cursorId: args.cursorId,
    })

    if (cursorRow) {
      where = {
        AND: [
          baseWhere,
          {
            OR: [
              { createdAt: { lt: cursorRow.createdAt } },
              { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
            ],
          },
        ],
      }
    }
  }

  const rows = await prisma.adminNotification.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    select: adminNotificationListSelect,
  })

  const hasMore = rows.length > take
  const items = hasMore ? rows.slice(0, take) : rows
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null

  return {
    items,
    nextCursor,
  }
}

export async function getUnreadAdminNotificationCount(args: {
  adminUserId: string
}): Promise<number> {
  return prisma.adminNotification.count({
    where: {
      adminUserId: args.adminUserId,
      archivedAt: null,
      readAt: null,
    },
  })
}

export async function markAllAdminNotificationsRead(args: {
  adminUserId: string
}): Promise<{ count: number }> {
  const now = new Date()

  const updated = await prisma.adminNotification.updateMany({
    where: {
      adminUserId: args.adminUserId,
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
