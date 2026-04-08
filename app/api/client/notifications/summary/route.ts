// app/api/client/notifications/summary/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { prisma } from '@/lib/prisma'
import { NotificationEventKey } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const clientId = auth.clientId

    const [
      pendingUnreadCount,
      aftercareUnreadCount,
      upcomingUnreadCount,
    ] = await Promise.all([
      prisma.clientNotification.count({
        where: {
          clientId,
          readAt: null,
          eventKey: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
        },
      }),

      prisma.clientNotification.count({
        where: {
          clientId,
          readAt: null,
          eventKey: NotificationEventKey.AFTERCARE_READY,
        },
      }),

      prisma.clientNotification.count({
        where: {
          clientId,
          readAt: null,
          eventKey: {
            in: [
              NotificationEventKey.BOOKING_CONFIRMED,
              NotificationEventKey.BOOKING_RESCHEDULED,
              NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
              NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
              NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
              NotificationEventKey.APPOINTMENT_REMINDER,
            ],
          },
        },
      }),
    ])

    return jsonOk({
      pendingUnreadCount,
      aftercareUnreadCount,
      upcomingUnreadCount,
      hasAnyUnreadUpdates:
        pendingUnreadCount > 0 ||
        aftercareUnreadCount > 0 ||
        upcomingUnreadCount > 0,
    })
  } catch (err: unknown) {
    console.error('GET /api/client/notifications/summary error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}