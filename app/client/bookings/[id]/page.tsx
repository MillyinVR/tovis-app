// app/client/bookings/[id]/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ReviewSection from './ReviewSection'
import BookingActions from './BookingActions'

export const dynamic = 'force-dynamic'

function toDate(v: unknown): Date | null {
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

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function friendlyLocationType(v: unknown) {
  const s = upper(v)
  if (s === 'SALON') return 'In salon'
  if (s === 'MOBILE') return 'Mobile'
  return null
}

function friendlySource(v: unknown) {
  const s = upper(v)
  if (s === 'DISCOVERY') return 'Looks'
  if (s === 'REQUESTED') return 'Requested'
  if (s === 'AFTERCARE') return 'Aftercare rebook'
  return null
}

function statusPillTone(statusRaw: unknown) {
  const s = String(statusRaw || '').toUpperCase()
  if (s === 'CANCELLED') return { bg: '#fff1f2', color: '#9f1239' }
  if (s === 'COMPLETED') return { bg: '#ecfdf5', color: '#065f46' }
  if (s === 'PENDING') return { bg: '#fffbeb', color: '#854d0e' }
  return { bg: '#ecfeff', color: '#155e75' } // ACCEPTED/other
}

function statusMessage(statusRaw: unknown) {
  const s = String(statusRaw || '').toUpperCase()

  if (s === 'PENDING') {
    return {
      title: 'Request sent',
      body: 'Your professional hasn’t approved this yet. You’ll see it move to Confirmed once accepted.',
      tone: { bg: '#fffbeb', border: '#fde68a', color: '#854d0e' },
    }
  }

  if (s === 'ACCEPTED') {
    return {
      title: 'Confirmed',
      body: 'You’re booked. Show up cute and on time. Future-you will thank you.',
      tone: { bg: '#ecfeff', border: '#a5f3fc', color: '#155e75' },
    }
  }

  if (s === 'COMPLETED') {
    return {
      title: 'Completed',
      body: 'All done. Leave a review if you haven’t already (professionals live for that).',
      tone: { bg: '#ecfdf5', border: '#a7f3d0', color: '#065f46' },
    }
  }

  if (s === 'CANCELLED') {
    return {
      title: 'Cancelled',
      body: 'This booking is cancelled. If you still want the service, book a new time.',
      tone: { bg: '#fff1f2', border: '#fecdd3', color: '#9f1239' },
    }
  }

  return {
    title: 'Booking status',
    body: 'We’re tracking this booking. Status updates will show here.',
    tone: { bg: '#f3f4f6', border: '#e5e7eb', color: '#111827' },
  }
}

function locationLine(pro?: { location?: string | null; city?: string | null; state?: string | null } | null) {
  if (!pro) return ''
  const parts = [pro.location, pro.city, pro.state].filter(Boolean)
  return parts.join(', ')
}

function formatPriceMaybe(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return `$${v.toFixed(2)}`
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

export default async function ClientBookingPage({ params }: { params: { id: string } }) {
  const bookingId = params.id

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect(`/login?from=${encodeURIComponent(`/client/bookings/${bookingId}`)}`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      service: true,
      professional: { include: { user: true } },
      aftercareSummary: true,
    },
  })

  if (!booking) notFound()
  if (booking.clientId !== user.clientProfile.id) redirect('/client/bookings')

  const existingReview = await prisma.review.findFirst({
    where: { bookingId: booking.id, clientId: user.clientProfile.id },
    include: {
      mediaAssets: {
        select: {
          id: true,
          url: true,
          thumbUrl: true,
          mediaType: true,
          createdAt: true,
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const scheduled = toDate(booking.scheduledFor)

  // ✅ show in PRO timezone (consistent with booking flow)
  const appointmentTz = sanitizeTimeZone((booking.professional as any)?.timeZone) ?? 'America/Los_Angeles'
  const whenLabel = scheduled ? formatWhenInTimeZone(scheduled, appointmentTz) : 'Unknown time'

  const loc = locationLine(booking.professional)
  const pill = statusPillTone(booking.status)
  const msg = statusMessage(booking.status)

  const duration = booking.durationMinutesSnapshot ?? null
  const priceLabel = formatPriceMaybe((booking as any).priceSnapshot)

  const modeLabel = friendlyLocationType((booking as any).locationType)
  const sourceLabel = friendlySource((booking as any).source)

  return (
    <main style={{ maxWidth: 720, margin: '80px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>{booking.service?.name || 'Booking'}</h1>

      {/* Top row: back + status pill */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <a
          href="/client/bookings"
          style={{
            textDecoration: 'none',
            border: '1px solid #e5e7eb',
            background: '#fff',
            color: '#111',
            borderRadius: 999,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 900,
          }}
        >
          ← Back to bookings
        </a>

        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '4px 10px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 900,
            border: '1px solid #e5e7eb',
            background: pill.bg,
            color: pill.color,
          }}
        >
          {String(booking.status || 'UNKNOWN').toUpperCase()}
        </span>
      </div>

      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>
        With {booking.professional?.businessName || booking.professional?.user?.email || 'your professional'}
      </div>

      {/* When + Where */}
      <div style={{ fontSize: 13, color: '#111', marginBottom: 10 }}>
        <span style={{ fontWeight: 800 }}>{whenLabel}</span>
        <span style={{ color: '#6b7280' }}> · {appointmentTz}</span>
        {loc ? <span style={{ color: '#6b7280' }}> · {loc}</span> : null}
      </div>

      {/* Tiny details row */}
      {(duration || priceLabel || modeLabel || sourceLabel) ? (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {duration ? <span style={{ fontWeight: 800, color: '#111' }}>{duration} min</span> : null}
          {priceLabel ? <span style={{ fontWeight: 800, color: '#111' }}>{priceLabel}</span> : null}
          {modeLabel ? (
            <span>
              <span style={{ fontWeight: 800, color: '#111' }}>Mode:</span> {modeLabel}
            </span>
          ) : null}
          {sourceLabel ? (
            <span>
              <span style={{ fontWeight: 800, color: '#111' }}>Source:</span> {sourceLabel}
            </span>
          ) : null}
        </div>
      ) : (
        <div style={{ marginBottom: 16 }} />
      )}

      {/* Status message card */}
      <section
        style={{
          borderRadius: 12,
          border: `1px solid ${msg.tone.border}`,
          background: msg.tone.bg,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 900, color: msg.tone.color, marginBottom: 4 }}>{msg.title}</div>
        <div style={{ fontSize: 13, color: '#111' }}>{msg.body}</div>
      </section>

      {/* Calendar link */}
      <a
        href={`/api/calendar?bookingId=${encodeURIComponent(booking.id)}`}
        style={{
          display: 'inline-block',
          textDecoration: 'none',
          border: '1px solid #ddd',
          borderRadius: 999,
          padding: '10px 14px',
          fontSize: 12,
          fontWeight: 900,
          color: '#111',
          background: '#fff',
          marginBottom: 16,
        }}
      >
        Add to calendar
      </a>

      {/* Booking actions (ONLY ONCE) */}
      <BookingActions
        bookingId={booking.id}
        status={booking.status as any}
        scheduledFor={scheduled ? scheduled.toISOString() : new Date().toISOString()}
        durationMinutesSnapshot={duration}
      />

      {/* AFTERCARE SUMMARY */}
      <section style={{ borderRadius: 12, border: '1px solid #eee', background: '#fff', padding: 12, marginTop: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Aftercare summary</div>

        {booking.aftercareSummary?.notes ? (
          <div style={{ fontSize: 13, color: '#374151' }}>{booking.aftercareSummary.notes}</div>
        ) : (
          <div style={{ fontSize: 12, color: '#9ca3af' }}>No aftercare notes provided.</div>
        )}
      </section>

      {/* REVIEW SECTION */}
      <ReviewSection
        bookingId={booking.id}
        existingReview={
          existingReview
            ? {
                id: existingReview.id,
                rating: existingReview.rating,
                headline: existingReview.headline,
                body: existingReview.body,
                mediaAssets: (existingReview.mediaAssets || []).map((m) => ({
                  id: m.id,
                  url: m.url,
                  thumbUrl: m.thumbUrl,
                  mediaType: m.mediaType,
                  createdAt: m.createdAt.toISOString(),
                  isFeaturedInPortfolio: m.isFeaturedInPortfolio,
                  isEligibleForLooks: m.isEligibleForLooks,
                })),
              }
            : null
        }
      />
    </main>
  )
}
