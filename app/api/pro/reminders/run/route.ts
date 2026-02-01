// app/api/pro/reminders/run/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { sendSmsReminder, formatReminderMessage, markRemindersSent } from '@/lib/reminders'
import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  pickTimeZoneOrNull,
  sanitizeTimeZone,
  getZonedParts,
  zonedTimeToUtc,
} from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

async function resolveProScheduleTimeZone(proId: string, proTimeZoneRaw: unknown): Promise<string> {
  const primary = await prisma.professionalLocation.findFirst({
    where: { professionalId: proId, isBookable: true, isPrimary: true },
    select: { timeZone: true },
  })
  const primaryTz = pickTimeZoneOrNull(primary?.timeZone)
  if (primaryTz) return primaryTz

  const any = await prisma.professionalLocation.findFirst({
    where: { professionalId: proId, isBookable: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { timeZone: true },
  })
  const anyTz = pickTimeZoneOrNull(any?.timeZone)
  if (anyTz) return anyTz

  const proTz = pickTimeZoneOrNull(proTimeZoneRaw)
  if (proTz) return proTz

  return DEFAULT_TIME_ZONE
}

/**
 * STRICT: booking tz must be present AND valid IANA.
 * No schedule fallback. No UTC fallback. No pro fallback.
 */
function requireBookingTimeZone(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return null
  return isValidIanaTimeZone(s) ? s : null
}

/**
 * DST-safe "tomorrow" window computed in scheduleTz.
 */
function computeTomorrowWindowUtc(nowUtc: Date, scheduleTz: string) {
  const tz = sanitizeTimeZone(scheduleTz, DEFAULT_TIME_ZONE)
  const p = getZonedParts(nowUtc, tz)

  const startOfTomorrowUtc = zonedTimeToUtc({
    year: p.year,
    month: p.month,
    day: p.day + 1,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  const startOfDayAfterUtc = zonedTimeToUtc({
    year: p.year,
    month: p.month,
    day: p.day + 2,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  return { tz, startOfTomorrowUtc, startOfDayAfterUtc }
}

export async function POST() {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const pro = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { timeZone: true, businessName: true },
    })

    const businessName = pro?.businessName ?? null

    // ✅ schedule tz for batching window only (never LA fallback)
    const scheduleTz = await resolveProScheduleTimeZone(professionalId, pro?.timeZone)

    // ✅ DST-safe window
    const nowUtc = new Date()
    const { startOfTomorrowUtc, startOfDayAfterUtc } = computeTomorrowWindowUtc(nowUtc, scheduleTz)

    const bookings = await prisma.booking.findMany({
      where: {
        professionalId,
        status: { in: ['PENDING', 'ACCEPTED'] as any },
        scheduledFor: { gte: startOfTomorrowUtc, lt: startOfDayAfterUtc },
        reminderSentAt: null,
      },
      select: {
        id: true,
        scheduledFor: true,
        locationTimeZone: true, // ✅ REQUIRED for strict message tz
        client: { select: { firstName: true, phone: true } },
        service: { select: { name: true } },
      },
      take: 2000,
    })

    const sentIds: string[] = []
    const skipped: { id: string; reason: string }[] = []

    for (const b of bookings) {
      const phone = String(b.client?.phone || '').trim()
      if (!phone) {
        skipped.push({ id: b.id, reason: 'no_phone' })
        continue
      }

      // ✅ STRICT: no tz = no reminder
      const bookingTz = requireBookingTimeZone(b.locationTimeZone)
      if (!bookingTz) {
        skipped.push({ id: b.id, reason: 'missing_or_invalid_booking_timezone' })
        continue
      }

      const clientFirstName = String(b.client?.firstName || '').trim() || 'there'
      const serviceName = String(b.service?.name || '').trim() || 'appointment'

      const message = formatReminderMessage({
        clientFirstName,
        serviceName,
        scheduledFor: new Date(b.scheduledFor),
        businessName,
        timeZone: bookingTz, // ✅ strict truth
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
        scheduleTimeZoneUsed: scheduleTz, // batching only
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
