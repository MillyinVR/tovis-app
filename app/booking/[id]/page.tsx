// app/booking/[id]/page.tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { sanitizeTimeZone } from '@/lib/timeZone'
import { moneyToString } from '@/lib/money'
import { mapsHrefFromLocation } from '@/lib/maps'
import { messageStartHref } from '@/lib/messages'

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
  if (s === 'PENDING') return 'Requested (waiting for confirmation)'
  if (s === 'ACCEPTED') return 'Confirmed'
  if (s === 'CANCELLED') return 'Cancelled'
  if (s === 'COMPLETED') return 'Completed'
  return s || 'Unknown'
}

type ServiceItemRow = {
  id: string
  serviceId: string
  offeringId: string | null
  priceSnapshot: Prisma.Decimal
  durationMinutesSnapshot: number
  sortOrder: number
  notes: string | null
  service: { name: string }
}

function isAddOnItem(x: Pick<ServiceItemRow, 'notes' | 'sortOrder'>) {
  const n = (x.notes || '').trim().toUpperCase()
  if (n.startsWith('ADDON:')) return true
  return (x.sortOrder ?? 0) >= 100
}

function sumDecimal(values: Prisma.Decimal[]) {
  return values.reduce((acc, v) => acc.add(v), new Prisma.Decimal(0))
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

      subtotalSnapshot: true,
      totalDurationMinutes: true,

      service: {
        select: {
          id: true,
          name: true,
          defaultDurationMinutes: true,
          category: { select: { name: true } },
        },
      },

      serviceItems: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          serviceId: true,
          offeringId: true,
          priceSnapshot: true,
          durationMinutesSnapshot: true,
          sortOrder: true,
          notes: true,
          service: { select: { name: true } },
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
              placeId: true,
              lat: true,
              lng: true,
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
  const locationLabel =
    primaryLoc?.formattedAddress?.trim() ||
    primaryLoc?.name?.trim() ||
    [primaryLoc?.city, primaryLoc?.state].filter(Boolean).join(', ') ||
    null

  const isSalon = upper(booking.locationType) === 'SALON'
  const mapsHref = isSalon
    ? mapsHrefFromLocation({
        placeId: primaryLoc?.placeId ?? null,
        lat: primaryLoc?.lat ?? null,
        lng: primaryLoc?.lng ?? null,
        formattedAddress: primaryLoc?.formattedAddress ?? null,
        name: primaryLoc?.name ?? null,
      })
    : null

  const appointmentTz = sanitizeTimeZone(prof?.timeZone ?? null, 'America/Los_Angeles')
  const when = fmtInTimeZone(new Date(booking.scheduledFor), appointmentTz)

  const calendarHref = `/api/calendar?bookingId=${encodeURIComponent(booking.id)}`
  const proProfileHref = prof?.id ? `/professionals/${encodeURIComponent(prof.id)}` : null

  const messageHref =
    isClientViewer || isProViewer
      ? messageStartHref({ kind: 'BOOKING', bookingId: booking.id })
      : null


  const duration =
    (Number(booking.totalDurationMinutes ?? 0) > 0
      ? Number(booking.totalDurationMinutes)
      : svc?.defaultDurationMinutes) ?? null

  const locationTypeLabel = friendlyLocationType(booking.locationType)
  const sourceLabel = friendlySource(booking.source)
  const statusLabel = friendlyStatus(booking.status)

  const isWaiting = upper(booking.status) === 'PENDING'

  // ---- line items breakdown ----
  const items = (booking.serviceItems ?? []) as ServiceItemRow[]
  const baseItems = items.filter((x) => !isAddOnItem(x))
  const addOnItems = items.filter((x) => isAddOnItem(x))

  const addOnPrice = sumDecimal(addOnItems.map((x) => x.priceSnapshot))
  const addOnMinutes = addOnItems.reduce((sum, x) => sum + (Number(x.durationMinutesSnapshot) || 0), 0)

  const subtotalLabel = booking.subtotalSnapshot ? moneyToString(booking.subtotalSnapshot) : null

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

            {locationLabel ? (
              mapsHref ? (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-textSecondary hover:opacity-80"
                >
                  {' · '}
                  {locationLabel}
                </a>
              ) : (
                <span className="text-textSecondary"> · {locationLabel}</span>
              )
            ) : null}
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

            {subtotalLabel ? (
              <span>
                <span className="font-black text-textPrimary">Est. subtotal:</span> ${subtotalLabel}
              </span>
            ) : null}

            {sourceLabel ? (
              <span>
                <span className="font-black text-textPrimary">Source:</span> {sourceLabel}
              </span>
            ) : null}
          </div>

          {isWaiting ? (
            <div className="tovis-glass-soft mt-3 rounded-card p-3 text-[12px] font-semibold text-textSecondary">
              No charge yet. Once the pro confirms, your booking updates automatically in your dashboard.
            </div>
          ) : null}
        </div>

        <Link href="/looks" className="text-[12px] font-black text-textPrimary hover:opacity-80">
          ← Back to Looks
        </Link>
      </div>

      {/* Booking breakdown (base + add-ons) */}
      {items.length ? (
        <div className="tovis-glass mt-4 rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="text-[12px] font-black text-textSecondary">Service breakdown</div>

          <div className="mt-3 grid gap-2">
            {baseItems.map((x) => {
              const price = moneyToString(x.priceSnapshot) ?? '0.00'
              const mins = Number(x.durationMinutesSnapshot) || 0
              return (
                <div
                  key={x.id}
                  className="flex items-center justify-between rounded-card border border-white/10 bg-bgPrimary/35 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-black text-textPrimary">{x.service.name}</div>
                    <div className="mt-1 text-[11px] font-semibold text-textSecondary">{mins} min</div>
                  </div>
                  <div className="shrink-0 text-[12px] font-black text-textPrimary">${price}</div>
                </div>
              )
            })}
          </div>

          {addOnItems.length ? (
            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="text-[12px] font-black text-textSecondary">Add-ons</div>

              <div className="mt-3 grid gap-2">
                {addOnItems.map((x) => {
                  const price = moneyToString(x.priceSnapshot) ?? '0.00'
                  const mins = Number(x.durationMinutesSnapshot) || 0
                  return (
                    <div
                      key={x.id}
                      className="flex items-center justify-between rounded-card border border-white/10 bg-bgPrimary/35 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-black text-textPrimary">{x.service.name}</div>
                        <div className="mt-1 text-[11px] font-semibold text-textSecondary">+{mins} min</div>
                      </div>
                      <div className="shrink-0 text-[12px] font-black text-textPrimary">${price}</div>
                    </div>
                  )
                })}
              </div>

              <div className="tovis-glass-soft mt-3 rounded-card border border-white/10 px-4 py-3 text-[12px] font-semibold text-textSecondary">
                Add-ons total:{' '}
                <span className="font-black text-textPrimary">${moneyToString(addOnPrice) ?? '0.00'}</span> · Time:{' '}
                <span className="font-black text-textPrimary">{addOnMinutes} min</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="tovis-glass mt-4 rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="text-[12px] font-black text-textSecondary">Next moves</div>

        <div className="mt-2 text-[12px] font-semibold text-textSecondary">
          {isWaiting
            ? 'Most pros confirm quickly. You’ll see it update automatically.'
            : 'You’re all set. Keep this handy for day-of details.'}
        </div>

        <div className="mt-3 grid gap-2">
          <a
            href={calendarHref}
            className="rounded-full border border-white/10 bg-bgPrimary px-4 py-3 text-center text-[13px] font-black text-textPrimary hover:border-white/20"
          >
            Add to calendar
          </a>
          {messageHref ? (
            <Link
              href={messageHref}
              className="rounded-full border border-white/10 bg-bgPrimary px-4 py-3 text-center text-[13px] font-black text-textPrimary hover:border-white/20"
            >
              {isClientViewer ? `Message ${proName}` : 'Message client'}
            </Link>

          ) : null}


          {proProfileHref ? (
            <Link
              href={proProfileHref}
              className="rounded-full border border-white/10 bg-bgPrimary px-4 py-3 text-center text-[13px] font-black text-textPrimary hover:border-white/20"
            >
              View {proName} profile
            </Link>
          ) : null}

          <Link
            href={isProViewer ? '/pro/bookings' : '/client/bookings'}
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
