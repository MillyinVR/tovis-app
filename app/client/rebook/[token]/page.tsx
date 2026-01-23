// app/client/rebook/[token]/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type SearchParamsShape = {
  recommendedAt?: string
  windowStart?: string
  windowEnd?: string
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function toDate(v: unknown): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

function formatWhenInTimeZone(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function formatDateRangeInTimeZone(start: Date, end: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${fmt.format(start)} – ${fmt.format(end)}`
}

type RebookInfo =
  | { mode: 'BOOKED_NEXT_APPOINTMENT'; label: string; bookedAt: Date }
  | { mode: 'RECOMMENDED_WINDOW'; label: string; windowStart: Date; windowEnd: Date }
  | { mode: 'RECOMMENDED_DATE'; label: string; recommendedAt: Date }
  | { mode: 'NONE'; label: null }

function computeRebookInfo(
  aftercare: {
    rebookMode: string
    rebookedFor: Date | null
    rebookWindowStart: Date | null
    rebookWindowEnd: Date | null
  },
  timeZone: string,
): RebookInfo {
  const mode = String(aftercare.rebookMode || '').toUpperCase()

  if (mode === 'BOOKED_NEXT_APPOINTMENT') {
    const d = toDate(aftercare.rebookedFor)
    if (!d) return { mode: 'NONE', label: null }
    return {
      mode: 'BOOKED_NEXT_APPOINTMENT',
      label: `Next appointment booked: ${formatWhenInTimeZone(d, timeZone)}`,
      bookedAt: d,
    }
  }

  if (mode === 'RECOMMENDED_WINDOW') {
    const s = toDate(aftercare.rebookWindowStart)
    const e = toDate(aftercare.rebookWindowEnd)
    if (s && e) {
      return {
        mode: 'RECOMMENDED_WINDOW',
        label: `Recommended rebook window: ${formatDateRangeInTimeZone(s, e, timeZone)}`,
        windowStart: s,
        windowEnd: e,
      }
    }
    return { mode: 'NONE', label: null }
  }

  // Back-compat: single date set without mode
  const legacy = toDate(aftercare.rebookedFor)
  if (legacy) {
    return {
      mode: 'RECOMMENDED_DATE',
      label: `Recommended next visit: ${formatWhenInTimeZone(legacy, timeZone)}`,
      recommendedAt: legacy,
    }
  }

  return { mode: 'NONE', label: null }
}

export default async function ClientRebookFromAftercarePage(props: {
  params: { token: string } | Promise<{ token: string }>
  searchParams?: SearchParamsShape | Promise<SearchParamsShape>
}) {
  const { token } = await Promise.resolve(props.params as any)
  const publicToken = pickString(token)
  if (!publicToken) notFound()

  const sp = props.searchParams ? await Promise.resolve(props.searchParams as any) : undefined
  const recommendedAtFromUrl = pickString(sp?.recommendedAt)
  const windowStartFromUrl = pickString(sp?.windowStart)
  const windowEndFromUrl = pickString(sp?.windowEnd)

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect(`/login?from=${encodeURIComponent(`/client/rebook/${publicToken}`)}`)
  }

  const aftercare = await prisma.aftercareSummary.findUnique({
    where: { publicToken },
    select: {
      notes: true,
      rebookMode: true,
      rebookedFor: true,
      rebookWindowStart: true,
      rebookWindowEnd: true,
      booking: {
        select: {
          id: true,
          clientId: true,
          professionalId: true,
          serviceId: true,
          offeringId: true,
          service: { select: { name: true } },
          professional: {
            select: {
              id: true,
              businessName: true,
              timeZone: true,
              user: { select: { email: true } },
            },
          },
        },
      },
    },
  })

  if (!aftercare?.booking) notFound()
  if (aftercare.booking.clientId !== user.clientProfile.id) notFound()

  const booking = aftercare.booking

  let offeringId = pickString(booking.offeringId)
  if (!offeringId) {
    const fallbackOffering = await prisma.professionalServiceOffering.findFirst({
      where: {
        professionalId: booking.professionalId,
        serviceId: booking.serviceId,
        isActive: true,
      },
      select: { id: true },
    })
    offeringId = fallbackOffering?.id ?? null
  }
  if (!offeringId) notFound()

  // Appointment timezone (currently using professional tz as the display tz)
  const appointmentTz = sanitizeTimeZone(booking.professional?.timeZone, 'America/Los_Angeles')

  const proLabel = booking.professional?.businessName || booking.professional?.user?.email || 'your professional'
  const serviceName = booking.service?.name || 'Service'
  const notes = typeof aftercare.notes === 'string' ? aftercare.notes : null

  const rebookInfo = computeRebookInfo(
    {
      rebookMode: aftercare.rebookMode,
      rebookedFor: aftercare.rebookedFor,
      rebookWindowStart: aftercare.rebookWindowStart,
      rebookWindowEnd: aftercare.rebookWindowEnd,
    },
    appointmentTz,
  )

  // If mode = BOOKED_NEXT_APPOINTMENT, try to find the actual “next booking”
  let nextBooking: { id: string; scheduledFor: Date; status: string } | null = null

  if (rebookInfo.mode === 'BOOKED_NEXT_APPOINTMENT') {
    try {
      nextBooking = await prisma.booking.findFirst({
        where: {
          rebookOfBookingId: booking.id,
          source: 'AFTERCARE',
          status: { not: 'CANCELLED' },
        } as any,
        orderBy: { scheduledFor: 'asc' },
        select: { id: true, scheduledFor: true, status: true },
      })
    } catch {
      nextBooking = null
    }
  }

  // Build booking CTA URL into your offering page
  const baseParams = new URLSearchParams({
    source: 'AFTERCARE',
    token: publicToken,
    rebookOfBookingId: booking.id,
  })

  const bookParams = new URLSearchParams(baseParams)
  if (recommendedAtFromUrl) bookParams.set('recommendedAt', recommendedAtFromUrl)
  if (windowStartFromUrl) bookParams.set('windowStart', windowStartFromUrl)
  if (windowEndFromUrl) bookParams.set('windowEnd', windowEndFromUrl)

  // If no URL params provided, seed them from aftercare
  if (!recommendedAtFromUrl && !windowStartFromUrl && !windowEndFromUrl) {
    if (rebookInfo.mode === 'RECOMMENDED_DATE') {
      bookParams.set('recommendedAt', rebookInfo.recommendedAt.toISOString())
    } else if (rebookInfo.mode === 'RECOMMENDED_WINDOW') {
      bookParams.set('windowStart', rebookInfo.windowStart.toISOString())
      bookParams.set('windowEnd', rebookInfo.windowEnd.toISOString())
    }
  }

  const bookHref = `/offerings/${encodeURIComponent(offeringId)}?${bookParams.toString()}`

  const proId = booking.professional?.id || booking.professionalId

  return (
    <main style={{ maxWidth: 720, margin: '80px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <a
        href={`/client/bookings/${encodeURIComponent(booking.id)}`}
        className="border border-surfaceGlass/10 bg-bgSecondary text-textPrimary"
        style={{
          textDecoration: 'none',
          borderRadius: 999,
          padding: '8px 12px',
          fontSize: 12,
          fontWeight: 900,
          display: 'inline-block',
          marginBottom: 14,
        }}
      >
        ← Back to booking
      </a>

      <h1 className="text-textPrimary" style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
        Aftercare for {serviceName}
      </h1>

      <div className="text-textSecondary" style={{ fontSize: 13, marginTop: 6 }}>
        With{' '}
        {proId ? (
          <a href={`/professionals/${encodeURIComponent(proId)}`} className="hover:underline underline-offset-4">
            {proLabel}
          </a>
        ) : (
          proLabel
        )}
      </div>

      <section className="border border-surfaceGlass/10 bg-bgSecondary" style={{ borderRadius: 12, padding: 12, marginTop: 16 }}>
        <div className="text-textPrimary" style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>
          Aftercare notes
        </div>
        {notes ? (
          <div className="text-textSecondary" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
            {notes}
          </div>
        ) : (
          <div className="text-textSecondary" style={{ fontSize: 12, opacity: 0.75 }}>
            No aftercare notes provided.
          </div>
        )}
      </section>

      <section className="border border-surfaceGlass/10 bg-bgSecondary" style={{ borderRadius: 12, padding: 12, marginTop: 12 }}>
        <div className="text-textPrimary" style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>
          Rebook
        </div>

        {rebookInfo.label ? (
          <div className="text-textSecondary" style={{ fontSize: 13, marginBottom: 10 }}>
            {rebookInfo.label}
            <span style={{ opacity: 0.75 }}> · {appointmentTz}</span>
          </div>
        ) : (
          <div className="text-textSecondary" style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
            No rebook recommendation yet.
          </div>
        )}

        {nextBooking ? (
          <a
            href={`/client/bookings/${encodeURIComponent(nextBooking.id)}`}
            className="bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover"
            style={{
              display: 'inline-block',
              textDecoration: 'none',
              borderRadius: 999,
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 900,
            }}
          >
            View your booked appointment
          </a>
        ) : (
          <a
            href={bookHref}
            className="bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover"
            style={{
              display: 'inline-block',
              textDecoration: 'none',
              borderRadius: 999,
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 900,
              opacity: rebookInfo.mode === 'NONE' ? 0.7 : 1,
            }}
          >
            Book your next appointment
          </a>
        )}

        <div className="text-textSecondary" style={{ fontSize: 11, opacity: 0.75, marginTop: 8 }}>
          If you don’t see times you want, your pro may need to open more availability.
        </div>
      </section>

      <section className="text-textSecondary" style={{ marginTop: 12, fontSize: 11, opacity: 0.75 }}>
        <div>Aftercare link</div>
        <div style={{ wordBreak: 'break-all' }}>/client/rebook/{publicToken}</div>
      </section>
    </main>
  )
}
