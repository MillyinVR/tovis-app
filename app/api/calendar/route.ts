// app/api/calendar/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function sanitizeTimeZone(tz: string | null | undefined) {
  if (!tz) return null
  if (!/^[A-Za-z_]+\/[A-Za-z0-9_\-+]+$/.test(tz)) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return tz
  } catch {
    return null
  }
}

function icsEscape(s: string) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/**
 * UTC in ICS format: YYYYMMDDTHHMMSSZ
 */
function toICSDateUtc(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  )
}

/**
 * Get "wall clock" parts for a UTC Date as rendered in a given timezone.
 */
function getZonedParts(dateUtc: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(dateUtc)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

/**
 * Local (TZID) ICS datetime: YYYYMMDDTHHMMSS (no trailing Z)
 * Represents the time in the provided timezone.
 */
function toICSDateInTimeZone(dUtc: Date, timeZone: string) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const z = getZonedParts(dUtc, timeZone)
  return (
    z.year +
    pad(z.month) +
    pad(z.day) +
    'T' +
    pad(z.hour) +
    pad(z.minute) +
    pad(z.second)
  )
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const bookingId = pickString(searchParams.get('bookingId'))
    if (!bookingId) return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 })

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        professional: { include: { user: true } },
        service: { include: { category: true } },
        client: { include: { user: true } },
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

    // Only the client or the pro can download this calendar file
    const isClient = Boolean(user.clientProfile?.id && booking.clientId === user.clientProfile.id)
    const isPro = Boolean(user.professionalProfile?.id && booking.professionalId === user.professionalProfile.id)
    if (!isClient && !isPro) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const startUtc = new Date(booking.scheduledFor)
    const minutes = Number(booking.durationMinutesSnapshot || 60)
    const endUtc = new Date(startUtc.getTime() + minutes * 60_000)

    const serviceName = booking.service?.name || 'Appointment'
    const proName = booking.professional?.businessName || booking.professional?.user?.email || 'Professional'
    const title = `${serviceName} with ${proName}`

    const location = booking.professional?.location || booking.professional?.city || ''

    const description = [
      `Service: ${serviceName}`,
      `Professional: ${proName}`,
      location ? `Location: ${location}` : null,
      `Booking ID: ${booking.id}`,
    ]
      .filter(Boolean)
      .join('\n')

    // ✅ Appointment timezone (professional)
    const appointmentTz = sanitizeTimeZone((booking.professional as any)?.timeZone) ?? 'America/Los_Angeles'

    const uid = `${booking.id}@tovis`
    const dtstamp = toICSDateUtc(new Date())

    // DTSTART/DTEND in TZID (no Z)
    const dtStartLocal = toICSDateInTimeZone(startUtc, appointmentTz)
    const dtEndLocal = toICSDateInTimeZone(endUtc, appointmentTz)

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TOVIS//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${icsEscape(uid)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${icsEscape(appointmentTz)}:${dtStartLocal}`,
      `DTEND;TZID=${icsEscape(appointmentTz)}:${dtEndLocal}`,
      `SUMMARY:${icsEscape(title)}`,
      location ? `LOCATION:${icsEscape(location)}` : null,
      `DESCRIPTION:${icsEscape(description)}`,
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]
      .filter(Boolean)
      .join('\r\n')

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="tovis-booking-${booking.id}.ics"`,
        // nice-to-have so browsers don’t “help” by sniffing
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    console.error('GET /api/calendar error', e)
    return NextResponse.json({ error: 'Failed to generate calendar invite.' }, { status: 500 })
  }
}
