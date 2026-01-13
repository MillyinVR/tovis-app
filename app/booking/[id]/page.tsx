// app/booking/[id]/page.tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: { id: string } | Promise<{ id: string }>
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

function fmtInTimeZone(dateUtc: Date, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(dateUtc)
}

function formatMoneyMaybe(v: unknown) {
  if (typeof v === 'number' && Number.isFinite(v)) return `$${v.toFixed(2)}`
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
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
  if (s === 'DISCOVERY') return 'Found in Looks'
  if (s === 'REQUESTED') return 'Requested booking'
  if (s === 'AFTERCARE') return 'Rebooked from aftercare'
  return null
}

function friendlyStatus(v: unknown) {
  const s = upper(v)
  if (s === 'PENDING') return 'Pending approval'
  if (s === 'ACCEPTED') return 'Confirmed'
  if (s === 'CANCELLED') return 'Cancelled'
  if (s === 'COMPLETED') return 'Completed'
  return s || 'Unknown'
}

export default async function BookingReceiptPage(props: PageProps) {
  const params = await props.params
  const id = params?.id
  if (!id || typeof id !== 'string') notFound()

  // ✅ If you’re not logged in, you don’t get to see anything.
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect(`/login?from=${encodeURIComponent(`/booking/${id}`)}`)

  // ✅ One query: booking + related bits we need for UI
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      professionalId: true,
      offeringId: true,

      scheduledFor: true,
      status: true,
      source: true,
      locationType: true,

      durationMinutesSnapshot: true,
      priceSnapshot: true,

      service: {
        select: {
          id: true,
          name: true,
          category: { select: { name: true } },
        },
      },

      professional: {
        select: {
          id: true,
          businessName: true,
          city: true,
          location: true,
          timeZone: true,
          user: { select: { email: true } },
        },
      },
    },
  })

  if (!booking) notFound()

  // ✅ Authorization: only the owning client OR owning pro can view.
  const isClientViewer = Boolean(user.clientProfile?.id && booking.clientId === user.clientProfile.id)
  const isProViewer = Boolean(user.professionalProfile?.id && booking.professionalId === user.professionalProfile.id)
  if (!isClientViewer && !isProViewer) notFound()

  const prof = booking.professional
  const svc = booking.service

  const proName = prof?.businessName || prof?.user?.email || 'Professional'
  const serviceName = svc?.name || 'Service'
  const location = prof?.location || prof?.city || null

  const appointmentTz = sanitizeTimeZone(prof?.timeZone ?? null) ?? 'America/Los_Angeles'
  const when = fmtInTimeZone(new Date(booking.scheduledFor), appointmentTz)

  // Next actions
  const calendarHref = `/api/calendar?bookingId=${encodeURIComponent(booking.id)}`
  const aftercareHref = `/aftercare?bookingId=${encodeURIComponent(booking.id)}`

  // Rebook path: prefer offering -> else pro profile -> else looks
  const rebookHref = booking.offeringId
    ? `/offerings/${booking.offeringId}`
    : prof?.id
      ? `/professionals/${prof.id}`
      : '/looks'

  // Optional metadata for clarity
  const duration = booking.durationMinutesSnapshot ?? null
  const price = formatMoneyMaybe(booking.priceSnapshot)
  const locationTypeLabel = friendlyLocationType(booking.locationType)
  const sourceLabel = friendlySource(booking.source)
  const statusLabel = friendlyStatus(booking.status)

  return (
    <main
      className="text-textPrimary"
      style={{ maxWidth: 860, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'baseline',
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Booking receipt</div>

          <h1 style={{ fontSize: 28, margin: '6px 0 0', fontWeight: 900 }}>
            {serviceName} with {proName}
          </h1>

          <div style={{ marginTop: 6, fontSize: 14 }}>
            <strong>{when}</strong>
            <span style={{ color: '#6b7280' }}> · {appointmentTz}</span>
            {location ? <span style={{ color: '#6b7280' }}> · {location}</span> : null}
          </div>

          <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span>
                <strong className="text-textPrimary">Status:</strong> {statusLabel}
            </span>

            {locationTypeLabel ? (
              <span>
                <strong className="text-textPrimary">Mode:</strong> {locationTypeLabel}
              </span>
            ) : null}

            {duration ? (
              <span>
                <strong className="text-textPrimary">Duration:</strong> {duration} min
              </span>
            ) : null}

            {price ? (
              <span>
                <strong className="text-textPrimary">Price:</strong> {price}
              </span>
            ) : null}

            {sourceLabel ? (
              <span>
                <strong className="text-textPrimary">Source:</strong> {sourceLabel}
              </span>
            ) : null}
          </div>
        </div>

        {/* Looks = discovery home */}
        <Link href="/looks" className="text-textPrimary" style={{ textDecoration: 'none', fontWeight: 900 }}>
          ← Back to Looks
        </Link>
      </div>

      <div
        className="border border-surfaceGlass/10 bg-bgSecondary"
        style={{ marginTop: 18, borderRadius: 14, padding: 14 }}
      >
        <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Next moves</div>

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <a
            href={calendarHref}
            className="border border-surfaceGlass/20 bg-bgSecondary text-textPrimary"
            style={{
              textDecoration: 'none',
              padding: '10px 12px',
              borderRadius: 12,
              fontWeight: 900,
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            Add to calendar
          </a>

          <Link
            href={aftercareHref}
            className="bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover"
            style={{
              textDecoration: 'none',
              padding: '10px 12px',
              borderRadius: 12,
              fontWeight: 900,
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            View aftercare
          </Link>

          <Link
            href={rebookHref}
            className="border border-surfaceGlass/20 bg-bgSecondary text-textPrimary"
            style={{
              textDecoration: 'none',
              padding: '10px 12px',
              borderRadius: 12,
              fontWeight: 900,
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            Book this again
          </Link>

          <Link
            href={isProViewer ? '/professional/bookings' : '/client/bookings'}
            className="border border-surfaceGlass/10 text-textPrimary"
            style={{
              textDecoration: 'none',
              background: '#fafafa',
              padding: '10px 12px',
              borderRadius: 12,
              fontWeight: 800,
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            Go to dashboard
          </Link>

          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Screenshot this if you’re the type to forget things. Most humans are.
          </div>
        </div>
      </div>

      {/* Optional little extra context (kept tiny) */}
      {svc?.category?.name ? (
        <div style={{ marginTop: 14, fontSize: 12, color: '#6b7280' }}>
          Category: <strong className="text-textPrimary">{svc.category.name}</strong>
        </div>
      ) : null}
    </main>
  )
}
