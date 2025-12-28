// app/client/rebook/[token]/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

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

function computeRebookInfo(aftercare: {
  rebookMode: string
  rebookedFor: Date | null
  rebookWindowStart: Date | null
  rebookWindowEnd: Date | null
}, timeZone: string): RebookInfo {
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
    // If mode says window but dates missing, don’t pretend it’s fine.
    return { mode: 'NONE', label: null }
  }

  // Back-compat / “we set a single date but didn’t set a mode”
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
  params: Promise<{ token: string }> | { token: string }
  searchParams?: Promise<SearchParamsShape> | SearchParamsShape
}) {
  const { token } = await props.params
  const publicToken = pickString(token)
  if (!publicToken) notFound()

  const sp = props.searchParams ? await props.searchParams : undefined
  const recommendedAtFromUrl = pickString(sp?.recommendedAt)
  const windowStartFromUrl = pickString(sp?.windowStart)
  const windowEndFromUrl = pickString(sp?.windowEnd)

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect(`/login?from=${encodeURIComponent(`/client/rebook/${publicToken}`)}`)
  }

  // Find aftercare by token
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
          service: true,
          professional: { include: { user: true } },
        },
      },
    },
  })

  if (!aftercare?.booking) notFound()

  // Security: don’t allow viewing someone else’s aftercare link while logged in
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

  const appointmentTz =
    sanitizeTimeZone(booking.professional?.timeZone) ?? 'America/Los_Angeles'

  const proName =
    booking.professional?.businessName ||
    booking.professional?.user?.email ||
    'your professional'

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
  // based on your schema: Booking.source=AFTERCARE and Booking.rebookOfBookingId=original booking id
  const nextBooking =
    rebookInfo.mode === 'BOOKED_NEXT_APPOINTMENT'
      ? await prisma.booking.findFirst({
          where: {
            rebookOfBookingId: booking.id,
            source: 'AFTERCARE',
            status: { not: 'CANCELLED' },
          },
          orderBy: { scheduledFor: 'desc' },
          select: { id: true, scheduledFor: true, status: true },
        })
      : null

  // CTA: you’ll wire this to your real “client selects time” flow.
  // If you already have a booking flow entry page, swap this href.
  const baseParams = new URLSearchParams({
    source: 'AFTERCARE',
    token: publicToken,
    rebookOfBookingId: booking.id,
  })

  const bookHrefBase = `/offerings/${encodeURIComponent(offeringId)}?${baseParams.toString()}`

  const bookParams = new URLSearchParams(baseParams)
  if (recommendedAtFromUrl) bookParams.set('recommendedAt', recommendedAtFromUrl)
  if (windowStartFromUrl) bookParams.set('windowStart', windowStartFromUrl)
  if (windowEndFromUrl) bookParams.set('windowEnd', windowEndFromUrl)

  if (!recommendedAtFromUrl && !windowStartFromUrl && !windowEndFromUrl) {
    if (rebookInfo.mode === 'RECOMMENDED_DATE') {
      bookParams.set('recommendedAt', rebookInfo.recommendedAt.toISOString())
    } else if (rebookInfo.mode === 'RECOMMENDED_WINDOW') {
      bookParams.set('windowStart', rebookInfo.windowStart.toISOString())
      bookParams.set('windowEnd', rebookInfo.windowEnd.toISOString())
    }
  }

  const bookHref =
    bookParams.toString() === baseParams.toString()
      ? bookHrefBase
      : `/offerings/${encodeURIComponent(offeringId)}?${bookParams.toString()}`

  return (
    <main style={{ maxWidth: 720, margin: '80px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <a
        href={`/client/bookings/${encodeURIComponent(booking.id)}`}
        style={{
          textDecoration: 'none',
          border: '1px solid #e5e7eb',
          background: '#fff',
          color: '#111',
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

      <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
        Aftercare for {serviceName}
      </h1>

      <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
        With {proName}
      </div>

      {/* Notes */}
      <section style={{ borderRadius: 12, border: '1px solid #eee', background: '#fff', padding: 12, marginTop: 16 }}>
        <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>Aftercare notes</div>
        {notes ? (
          <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap' }}>{notes}</div>
        ) : (
          <div style={{ fontSize: 12, color: '#9ca3af' }}>No aftercare notes provided.</div>
        )}
      </section>

      {/* Rebook */}
      <section style={{ borderRadius: 12, border: '1px solid #eee', background: '#fff', padding: 12, marginTop: 12 }}>
        <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>Rebook</div>

        {rebookInfo.label ? (
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 10 }}>
            {rebookInfo.label}
            <span style={{ color: '#9ca3af' }}> · {appointmentTz}</span>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10 }}>
            No rebook recommendation yet.
          </div>
        )}

        {nextBooking ? (
          <a
            href={`/client/bookings/${encodeURIComponent(nextBooking.id)}`}
            style={{
              display: 'inline-block',
              textDecoration: 'none',
              border: '1px solid #111',
              borderRadius: 999,
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 900,
              color: '#fff',
              background: '#111',
            }}
          >
            View your booked appointment
          </a>
        ) : (
          <a
            href={bookHref}
            style={{
              display: 'inline-block',
              textDecoration: 'none',
              border: '1px solid #111',
              borderRadius: 999,
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 900,
              color: '#fff',
              background: '#111',
              opacity: rebookInfo.mode === 'NONE' ? 0.7 : 1,
            }}
          >
            Book your next appointment
          </a>
        )}

        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
          If you don’t see times you want, your pro may need to open more availability.
        </div>
      </section>

      <section style={{ marginTop: 12, fontSize: 11, color: '#9ca3af' }}>
        <div>Aftercare link</div>
        <div style={{ wordBreak: 'break-all' }}>/client/rebook/{publicToken}</div>
      </section>
    </main>
  )
}
