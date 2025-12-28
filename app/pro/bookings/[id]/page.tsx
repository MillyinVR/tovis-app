// app/pro/bookings/[id]/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ConsultationForm from './ConsultationForm'
import AftercareForm from './aftercare/AftercareForm'
import { moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

type RebookMode = 'NONE' | 'BOOKED_NEXT_APPOINTMENT' | 'RECOMMENDED_WINDOW'

function toDate(value: Date | string) {
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDateTime(d: Date) {
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatTime(d: Date) {
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatStatus(status: string) {
  switch (status) {
    case 'PENDING':
      return 'Pending'
    case 'ACCEPTED':
      return 'Accepted'
    case 'COMPLETED':
      return 'Completed'
    case 'CANCELLED':
      return 'Cancelled'
    default:
      return status
  }
}

function isRebookMode(x: unknown): x is RebookMode {
  return x === 'NONE' || x === 'BOOKED_NEXT_APPOINTMENT' || x === 'RECOMMENDED_WINDOW'
}

export default async function BookingDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect(`/login?from=/pro/bookings/${encodeURIComponent(id)}`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      client: { include: { user: true } },
      service: true,
      aftercareSummary: true,
      mediaAssets: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          url: true,
          thumbUrl: true,
          mediaType: true,
          visibility: true,
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
          uploadedByRole: true,
          reviewId: true,
          createdAt: true,
        },
      },
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== user.professionalProfile.id) redirect('/pro')

  const scheduled = toDate(booking.scheduledFor)
  if (!scheduled) notFound()

  const now = new Date()
  const isToday = scheduled.toDateString() === now.toDateString()

  const startedAt = booking.startedAt ? toDate(booking.startedAt) : null
  const finishedAt = booking.finishedAt ? toDate(booking.finishedAt) : null

  const baseStr = moneyToString(booking.priceSnapshot) ?? '0.00'
  const discountStr =
    booking.discountAmount != null ? moneyToString(booking.discountAmount) ?? '0.00' : null

  const totalStr =
    booking.totalAmount != null ? moneyToString(booking.totalAmount) ?? baseStr : baseStr

  const hasDiscount = booking.discountAmount != null && Number(discountStr) > 0

  const mediaForUI = (booking.mediaAssets || []).map((m) => ({
    id: m.id,
    url: m.url,
    thumbUrl: m.thumbUrl ?? null,
    mediaType: m.mediaType,
    visibility: m.visibility,
    uploadedByRole: m.uploadedByRole ?? null,
    reviewId: m.reviewId ?? null,
    createdAt: m.createdAt.toISOString(),
  }))

  const aftercare = booking.aftercareSummary

  const existingRebookModeRaw = (aftercare as any)?.rebookMode
  const existingRebookMode = isRebookMode(existingRebookModeRaw)
    ? (existingRebookModeRaw as RebookMode)
    : null

  const existingRebookedFor =
    aftercare?.rebookedFor instanceof Date ? aftercare.rebookedFor.toISOString() : null

  const existingRebookWindowStart =
    (aftercare as any)?.rebookWindowStart instanceof Date
      ? (aftercare as any).rebookWindowStart.toISOString()
      : null

  const existingRebookWindowEnd =
    (aftercare as any)?.rebookWindowEnd instanceof Date
      ? (aftercare as any).rebookWindowEnd.toISOString()
      : null

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '24px auto 90px',
        padding: '0 16px',
        fontFamily: 'system-ui',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <a
          href="/pro/bookings"
          style={{
            fontSize: 12,
            color: '#555',
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          ← Back to bookings
        </a>

        <a
          href="/pro/bookings/new"
          style={{
            display: 'inline-block',
            padding: '8px 12px',
            borderRadius: 999,
            border: '1px solid #111',
            textDecoration: 'none',
            color: '#111',
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          + New booking
        </a>
      </div>

      <section
        style={{
          marginTop: 12,
          borderRadius: 12,
          border: '1px solid #eee',
          padding: 16,
          marginBottom: 20,
          background: '#fff',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: '#777', marginBottom: 4 }}>
            {isToday ? 'Today' : 'Appointment'}
          </div>

          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{booking.service.name}</h1>

          <div style={{ fontSize: 13, color: '#555', marginTop: 6 }}>
            {formatDateTime(scheduled)} • {Math.round(booking.durationMinutesSnapshot)} min
          </div>

          <div style={{ fontSize: 13, color: '#555', marginTop: 6 }}>
            {booking.client.firstName} {booking.client.lastName}
            {booking.client.user?.email ? ` • ${booking.client.user.email}` : ''}
            {booking.client.phone ? ` • ${booking.client.phone}` : ''}
          </div>
        </div>

        <div style={{ textAlign: 'right', fontSize: 12, minWidth: 220 }}>
          <div
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 999,
              border: '1px solid #ddd',
              marginBottom: 8,
              fontSize: 11,
            }}
          >
            {formatStatus(booking.status)}
          </div>

          <div style={{ color: '#6b7280', display: 'grid', gap: 4, justifyItems: 'end' }}>
            {hasDiscount ? (
              <>
                <div>
                  Base: <span style={{ textDecoration: 'line-through' }}>${baseStr}</span>
                </div>
                <div>Last-minute discount: -${discountStr}</div>
                <div style={{ color: '#111', fontWeight: 900 }}>Total: ${totalStr}</div>
              </>
            ) : (
              <div style={{ color: '#777' }}>Total: ${totalStr}</div>
            )}
          </div>

          {startedAt && !finishedAt && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#16a34a' }}>
              Session started {formatTime(startedAt)} (in progress)
            </div>
          )}

          {finishedAt && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280' }}>
              Session finished {formatTime(finishedAt)}
            </div>
          )}
        </div>
      </section>

      <nav
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          fontSize: 13,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <a
          href="#consultation"
          style={{
            padding: '6px 10px',
            borderRadius: 999,
            border: '1px solid #ddd',
            textDecoration: 'none',
            color: '#111',
            background: '#fafafa',
          }}
        >
          Consultation
        </a>

        <a
          href={`/pro/bookings/${encodeURIComponent(booking.id)}/aftercare`}
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
          Open aftercare
        </a>

        <a
          href="#aftercare"
          style={{
            padding: '6px 10px',
            borderRadius: 999,
            border: '1px solid #ddd',
            textDecoration: 'none',
            color: '#111',
            background: '#fafafa',
          }}
        >
          Aftercare section
        </a>
      </nav>

      <section id="consultation" style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Consultation</h2>

        <p style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>
          Capture what you agreed on before starting the service: look goals, techniques, and pricing.
        </p>

        <ConsultationForm
          bookingId={booking.id}
          initialNotes={booking.consultationNotes ?? ''}
          initialPrice={moneyToString(booking.consultationPrice) ?? ''}
        />
      </section>

      <section id="aftercare" style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Aftercare & rebooking</h2>

        <p style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>
          Use this after the service to record what you actually did, recommendations, and when they should come back.
        </p>

        <AftercareForm
          bookingId={booking.id}
          existingNotes={aftercare?.notes ?? ''}
          existingRebookMode={existingRebookMode}
          existingRebookedFor={existingRebookedFor}
          existingRebookWindowStart={existingRebookWindowStart}
          existingRebookWindowEnd={existingRebookWindowEnd}
          existingMedia={mediaForUI}
        />
      </section>
    </main>
  )
}
