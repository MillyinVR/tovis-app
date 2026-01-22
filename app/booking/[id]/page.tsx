// app/booking/[id]/page.tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: { id: string } | Promise<{ id: string }>
}

function fmtInTimeZone(dateUtc: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'America/Los_Angeles')
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
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
  const { id } = await Promise.resolve(props.params)
  if (!id || typeof id !== 'string') notFound()

  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect(`/login?from=${encodeURIComponent(`/booking/${id}`)}`)

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

      // ✅ SAFE: select only fields that definitely exist in your Prisma types right now.
      // If you later re-add snapshot fields in Prisma, you can add them back here.

      service: {
        select: {
          id: true,
          name: true,
          defaultDurationMinutes: true,
          category: { select: { name: true } },
        },
      },

      professional: {
        select: {
          id: true,
          businessName: true,
          timeZone: true,
          user: { select: { email: true } },
          locations: {
            where: { isPrimary: true },
            take: 1,
            select: {
              name: true,
              formattedAddress: true,
              city: true,
              state: true,
            },
          },
        },
      },
    },
  })

  if (!booking) notFound()

  const isClientViewer = Boolean(user.clientProfile?.id && booking.clientId === user.clientProfile.id)
  const isProViewer = Boolean(user.professionalProfile?.id && booking.professionalId === user.professionalProfile.id)
  if (!isClientViewer && !isProViewer) notFound()

  const prof = booking.professional
  const svc = booking.service

  const proName = prof?.businessName || prof?.user?.email || 'Professional'
  const serviceName = svc?.name || 'Service'

  const primaryLoc = prof?.locations?.[0] ?? null
  const location =
    primaryLoc?.formattedAddress?.trim() ||
    primaryLoc?.name?.trim() ||
    [primaryLoc?.city, primaryLoc?.state].filter(Boolean).join(', ') ||
    null

  const appointmentTz = sanitizeTimeZone(prof?.timeZone ?? null, 'America/Los_Angeles')
  const when = fmtInTimeZone(new Date(booking.scheduledFor), appointmentTz)

  const calendarHref = `/api/calendar?bookingId=${encodeURIComponent(booking.id)}`
  const aftercareHref = `/aftercare?bookingId=${encodeURIComponent(booking.id)}`
  const rebookHref = booking.offeringId
    ? `/offerings/${booking.offeringId}`
    : prof?.id
      ? `/professionals/${prof.id}`
      : '/looks'

  // ✅ Long-term-safe fallbacks:
  const duration = svc?.defaultDurationMinutes ?? null

  // If you have a real price field later, plug it in here.
  const price = null as string | null

  const locationTypeLabel = friendlyLocationType(booking.locationType)
  const sourceLabel = friendlySource(booking.source)
  const statusLabel = friendlyStatus(booking.status)

  return (
    <main className="mx-auto max-w-180 px-4 pb-24 pt-10 text-textPrimary">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-[12px] font-black text-textSecondary">Booking receipt</div>

          <h1 className="mt-1 text-[26px] font-black">
            {serviceName} with {proName}
          </h1>

          <div className="mt-1 text-[13px]">
            <span className="font-black">{when}</span>
            <span className="text-textSecondary"> · {appointmentTz}</span>
            {location ? <span className="text-textSecondary"> · {location}</span> : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-textSecondary">
            <span>
              <span className="font-black text-textPrimary">Status:</span> {statusLabel}
            </span>

            {locationTypeLabel ? (
              <span>
                <span className="font-black text-textPrimary">Mode:</span> {locationTypeLabel}
              </span>
            ) : null}

            {duration ? (
              <span>
                <span className="font-black text-textPrimary">Duration:</span> {duration} min
              </span>
            ) : null}

            {price ? (
              <span>
                <span className="font-black text-textPrimary">Price:</span> {price}
              </span>
            ) : null}

            {sourceLabel ? (
              <span>
                <span className="font-black text-textPrimary">Source:</span> {sourceLabel}
              </span>
            ) : null}
          </div>
        </div>

        <Link href="/looks" className="text-[12px] font-black text-textPrimary hover:opacity-80">
          ← Back to Looks
        </Link>
      </div>

      <div className="tovis-glass mt-4 rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="text-[12px] font-black text-textSecondary">Next moves</div>

        <div className="mt-3 grid gap-2">
          <a
            href={calendarHref}
            className="rounded-full border border-white/10 bg-bgPrimary px-4 py-3 text-center text-[13px] font-black text-textPrimary hover:border-white/20"
          >
            Add to calendar
          </a>

          <Link
            href={aftercareHref}
            className="rounded-full bg-accentPrimary px-4 py-3 text-center text-[13px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
          >
            View aftercare
          </Link>

          <Link
            href={rebookHref}
            className="rounded-full border border-white/10 bg-bgPrimary px-4 py-3 text-center text-[13px] font-black text-textPrimary hover:border-white/20"
          >
            Book this again
          </Link>

          <Link
            href={isProViewer ? '/professional/bookings' : '/client/bookings'}
            className="rounded-full border border-white/10 bg-bgPrimary px-4 py-3 text-center text-[13px] font-black text-textPrimary hover:border-white/20"
          >
            Go to dashboard
          </Link>

          <div className="text-[12px] text-textSecondary">
            Screenshot this if you’re the type to forget things. Statistically speaking: you are.
          </div>
        </div>
      </div>

      {svc?.category?.name ? (
        <div className="mt-4 text-[12px] text-textSecondary">
          Category: <span className="font-black text-textPrimary">{svc.category.name}</span>
        </div>
      ) : null}
    </main>
  )
}
