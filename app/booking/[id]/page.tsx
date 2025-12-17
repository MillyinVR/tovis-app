// app/booking/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
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
    hour: 'numeric',
    minute: '2-digit',
  }).format(dateUtc)
}

export default async function BookingReceiptPage(props: PageProps) {
  const params = await props.params
  const id = params?.id
  if (!id || typeof id !== 'string') notFound()

  const user = await getCurrentUser().catch(() => null)
  if (!user) notFound()

  const booking = await prisma.booking.findUnique({
    where: { id },
  })
  if (!booking) notFound()

  const isClient = Boolean(user.clientProfile?.id && booking.clientId === user.clientProfile.id)
  const isPro = Boolean(user.professionalProfile?.id && booking.professionalId === user.professionalProfile.id)
  if (!isClient && !isPro) notFound()

  // Pull related info using ids
  const [svc, prof] = await Promise.all([
    prisma.service.findUnique({
      where: { id: booking.serviceId },
      include: { category: true },
    }),
    prisma.professionalProfile.findUnique({
      where: { id: booking.professionalId },
      include: { user: true },
    }),
  ])

  const proName = prof?.businessName || prof?.user?.email || 'Professional'
  const serviceName = svc?.name || 'Service'
  const location = prof?.location || prof?.city || null

  // ✅ timezone: prefer pro timezone, fallback to LA
  const appointmentTz = sanitizeTimeZone((prof as any)?.timeZone) ?? 'America/Los_Angeles'
  const when = fmtInTimeZone(new Date(booking.scheduledFor), appointmentTz)

  const calendarHref = `/api/calendar?bookingId=${encodeURIComponent(booking.id)}`
  const rebookHref = booking.offeringId
    ? `/offerings/${booking.offeringId}`
    : prof?.id
      ? `/professionals/${prof.id}`
      : '/explore'
  const aftercareHref = `/aftercare?bookingId=${encodeURIComponent(booking.id)}`

  return (
    <main style={{ maxWidth: 860, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Booking confirmed</div>
          <h1 style={{ fontSize: 28, margin: '6px 0 0', fontWeight: 900 }}>
            {serviceName} with {proName}
          </h1>

          <div style={{ marginTop: 6, color: '#111', fontSize: 14 }}>
            <strong>{when}</strong>
            <span style={{ color: '#6b7280' }}> · {appointmentTz}</span>
            {location ? <span> · {location}</span> : null}
          </div>
        </div>

        <Link href="/looks" style={{ textDecoration: 'none', color: '#111', fontWeight: 900 }}>
          ← Back to Looks
        </Link>
      </div>

      <div style={{ marginTop: 18, border: '1px solid #eee', borderRadius: 14, padding: 14, background: '#fff' }}>
        <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Next moves</div>

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <a
            href={calendarHref}
            style={{
              textDecoration: 'none',
              border: '1px solid #ddd',
              background: '#fff',
              color: '#111',
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
            style={{
              textDecoration: 'none',
              background: '#111',
              color: '#fff',
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
            style={{
              textDecoration: 'none',
              border: '1px solid #ddd',
              background: '#fff',
              color: '#111',
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
            href="/client"
            style={{
              textDecoration: 'none',
              border: '1px solid #eee',
              background: '#fafafa',
              color: '#111',
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
    </main>
  )
}
