// app/api/client/notifications/summary/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { prisma } from '@/lib/prisma'
import { ClientNotificationType } from '@prisma/client'

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
          type: ClientNotificationType.CONSULTATION_PROPOSAL,
        },
      }),

      prisma.clientNotification.count({
        where: {
          clientId,
          readAt: null,
          type: ClientNotificationType.AFTERCARE,
        },
      }),

      prisma.clientNotification.count({
        where: {
          clientId,
          readAt: null,
          type: {
            in: [
              ClientNotificationType.BOOKING_CONFIRMED,
              ClientNotificationType.BOOKING_RESCHEDULED,
              ClientNotificationType.BOOKING_CANCELLED,
              ClientNotificationType.APPOINTMENT_REMINDER,
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