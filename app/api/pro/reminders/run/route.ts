// app/api/pro/reminders/run/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { sendSmsReminder, formatReminderMessage, markRemindersSent } from '@/lib/reminders'
import { sanitizeTimeZone, getZonedParts, zonedTimeToUtc } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const pro = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { timeZone: true, businessName: true },
    })

    const proTimeZone = sanitizeTimeZone(pro?.timeZone, 'America/Los_Angeles')
    const businessName = pro?.businessName ?? null

    // ✅ Compute "tomorrow" window in the PRO's timezone
    const nowUtc = new Date()
    const parts = getZonedParts(nowUtc, proTimeZone)

    const startOfTomorrowUtc = zonedTimeToUtc({
      year: parts.year,
      month: parts.month,
      day: parts.day + 1,
      hour: 0,
      minute: 0,
      second: 0,
      timeZone: proTimeZone,
    })

    const startOfDayAfterUtc = zonedTimeToUtc({
      year: parts.year,
      month: parts.month,
      day: parts.day + 2,
      hour: 0,
      minute: 0,
      second: 0,
      timeZone: proTimeZone,
    })

    const bookings = await prisma.booking.findMany({
      where: {
        professionalId,
        status: { in: ['PENDING', 'ACCEPTED'] as any },
        scheduledFor: { gte: startOfTomorrowUtc, lt: startOfDayAfterUtc },
        reminderSentAt: null,
      },
      include: {
        client: { include: { user: true } },
        service: true,
      },
      take: 2000,
    })

    const sentIds: string[] = []
    const skipped: { id: string; reason: string }[] = []

    for (const b of bookings) {
      const phone = String(b.client.phone || '').trim()
      if (!phone) {
        skipped.push({ id: b.id, reason: 'no_phone' })
        continue
      }

      const clientFirstName = String(b.client.firstName || '').trim() || 'there'
      const serviceName = String(b.service?.name || '').trim() || 'appointment'

      const message = formatReminderMessage({
        clientFirstName,
        serviceName,
        scheduledFor: new Date(b.scheduledFor),
        businessName,
        timeZone: proTimeZone,
      })

      try {
        await sendSmsReminder(phone, message)
        sentIds.push(b.id)
      } catch (err) {
        console.error('[reminders] Failed for booking', b.id, err)
        skipped.push({ id: b.id, reason: 'sms_error' })
      }
    }

    if (sentIds.length) {
      await markRemindersSent(sentIds)
    }

    return jsonOk(
      {
        processed: bookings.length,
        sent: sentIds.length,
        skipped,
        timeZoneUsed: proTimeZone,
        windowUtc: {
          start: startOfTomorrowUtc.toISOString(),
          end: startOfDayAfterUtc.toISOString(),
        },
      },
      200,
    )
  } catch (e) {
    console.error('POST /api/pro/reminders/run error', e)
    return jsonFail(500, 'Internal server error')
  }
}
