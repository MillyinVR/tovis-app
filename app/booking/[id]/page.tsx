// app/booking/[id]/page.tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToString } from '@/lib/money'
import { mapsHrefFromLocation } from '@/lib/maps'
import { messageStartHref } from '@/lib/messages'
import { DEFAULT_TIME_ZONE, pickTimeZoneOrNull, sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: { id: string } | Promise<{ id: string }>
}

const bookingReceiptSelect = {
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

  locationTimeZone: true,
  locationAddressSnapshot: true,
  locationLatSnapshot: true,
  locationLngSnapshot: true,

  location: {
    select: {
      id: true,
      name: true,
      formattedAddress: true,
      city: true,
      state: true,
      placeId: true,
      lat: true,
      lng: true,
      timeZone: true,
    },
  },

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
      location: true,
      user: { select: { email: true } },
    },
  },
} satisfies Prisma.BookingSelect

type BookingReceiptRow = Prisma.BookingGetPayload<{
  select: typeof bookingReceiptSelect
}>

type ServiceItemRow = BookingReceiptRow['serviceItems'][number]

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fmtInTimeZone(dateUtc: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
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
  if (s === 'WAITLIST') return 'Waitlist'
  return s || 'Unknown'
}

function isAddOnItem(item: Pick<ServiceItemRow, 'notes' | 'sortOrder'>) {
  const note = (item.notes || '').trim().toUpperCase()
  if (note.startsWith('ADDON:')) return true
  return (item.sortOrder ?? 0) >= 100
}

function sumDecimal(values: Prisma.Decimal[]) {
  return values.reduce((acc, value) => acc.add(value), new Prisma.Decimal(0))
}

function decimalToNumber(v: unknown): number | null {
  if (v == null) return null

  if (typeof v === 'number' && Number.isFinite(v)) {
    return v
  }

  if (typeof v === 'string') {
    const parsed = Number(v)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (typeof v === 'object' && v !== null) {
    const maybeToNumber = (v as { toNumber?: unknown }).toNumber
    if (typeof maybeToNumber === 'function') {
      const parsed = maybeToNumber.call(v) as number
      return Number.isFinite(parsed) ? parsed : null
    }

    const maybeToString = (v as { toString?: unknown }).toString
    if (typeof maybeToString === 'function') {
      const parsed = Number(String(maybeToString.call(v)))
      return Number.isFinite(parsed) ? parsed : null
    }
  }

  return null
}

function pickFormattedAddress(snapshot: Prisma.JsonValue | null | undefined): string | null {
  if (!isRecord(snapshot)) return null

  const raw = snapshot.formattedAddress
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

function resolveReceiptTimeZone(args: {
  bookingLocationTimeZone: string | null
  bookedLocationTimeZone: string | null | undefined
  proTimeZone: string | null | undefined
}) {
  const bookingTz = pickTimeZoneOrNull(args.bookingLocationTimeZone)
  if (bookingTz) return bookingTz

  const locationTz = pickTimeZoneOrNull(args.bookedLocationTimeZone)
  if (locationTz) return locationTz

  const proTz = pickTimeZoneOrNull(args.proTimeZone)
  if (proTz) return proTz

  return DEFAULT_TIME_ZONE
}

function buildBookedLocationLabel(booking: BookingReceiptRow) {
  const snapshotAddress = pickFormattedAddress(booking.locationAddressSnapshot)
  if (snapshotAddress) return snapshotAddress

  const bookedLocation = booking.location
  if (bookedLocation?.formattedAddress?.trim()) return bookedLocation.formattedAddress.trim()
  if (bookedLocation?.name?.trim()) return bookedLocation.name.trim()

  const cityState = [bookedLocation?.city, bookedLocation?.state].filter(Boolean).join(', ')
  if (cityState) return cityState

  const professionalLocation = booking.professional?.location?.trim()
  if (professionalLocation) return professionalLocation

  return null
}

function buildMapsHref(booking: BookingReceiptRow) {
  const isSalon = upper(booking.locationType) === 'SALON'
  if (!isSalon) return null

  const snapshotAddress = pickFormattedAddress(booking.locationAddressSnapshot)
  const snapshotLat = decimalToNumber(booking.locationLatSnapshot)
  const snapshotLng = decimalToNumber(booking.locationLngSnapshot)
  const hasSnapshotTruth = snapshotAddress || snapshotLat != null || snapshotLng != null

  const bookedLocation = booking.location

  return mapsHrefFromLocation({
    placeId: hasSnapshotTruth ? null : bookedLocation?.placeId ?? null,
    lat: snapshotLat ?? decimalToNumber(bookedLocation?.lat),
    lng: snapshotLng ?? decimalToNumber(bookedLocation?.lng),
    formattedAddress: snapshotAddress ?? bookedLocation?.formattedAddress ?? null,
    name: hasSnapshotTruth ? null : bookedLocation?.name ?? null,
  })
}

export default async function BookingReceiptPage(props: PageProps) {
  const { id } = await Promise.resolve(props.params)
  if (!id || typeof id !== 'string') notFound()

  const user = await getCurrentUser().catch(() => null)
  if (!user) {
    redirect(`/login?from=${encodeURIComponent(`/booking/${id}`)}`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: bookingReceiptSelect,
  })

  if (!booking) notFound()

  const isClientViewer = Boolean(user.clientProfile?.id && booking.clientId === user.clientProfile.id)
  const isProViewer = Boolean(user.professionalProfile?.id && booking.professionalId === user.professionalProfile.id)

  if (!isClientViewer && !isProViewer) notFound()

  const professional = booking.professional
  const service = booking.service

  const proName = professional?.businessName || professional?.user?.email || 'Professional'
  const serviceName = service?.name || 'Service'

  const appointmentTz = resolveReceiptTimeZone({
    bookingLocationTimeZone: booking.locationTimeZone,
    bookedLocationTimeZone: booking.location?.timeZone,
    proTimeZone: professional?.timeZone,
  })

  const when = fmtInTimeZone(new Date(booking.scheduledFor), appointmentTz)
  const locationLabel = buildBookedLocationLabel(booking)
  const mapsHref = buildMapsHref(booking)

  const calendarHref = `/api/calendar?bookingId=${encodeURIComponent(booking.id)}`
  const proProfileHref = professional?.id ? `/professionals/${encodeURIComponent(professional.id)}` : null
  const messageHref =
    isClientViewer || isProViewer
      ? messageStartHref({ kind: 'BOOKING', bookingId: booking.id })
      : null

  const dashboardHref = isProViewer ? '/pro/bookings' : '/client/bookings'
  const dashboardLabel = isProViewer ? 'Go to pro dashboard' : 'Go to dashboard'

  const duration =
    (Number(booking.totalDurationMinutes ?? 0) > 0
      ? Number(booking.totalDurationMinutes)
      : service?.defaultDurationMinutes) ?? null

  const locationTypeLabel = friendlyLocationType(booking.locationType)
  const sourceLabel = friendlySource(booking.source)
  const statusLabel = friendlyStatus(booking.status)
  const isWaiting = upper(booking.status) === 'PENDING'

  const items = booking.serviceItems ?? []
  const baseItems = items.filter((item) => !isAddOnItem(item))
  const addOnItems = items.filter((item) => isAddOnItem(item))

  const addOnPrice = sumDecimal(addOnItems.map((item) => item.priceSnapshot))
  const addOnMinutes = addOnItems.reduce(
    (sum, item) => sum + (Number(item.durationMinutesSnapshot) || 0),
    0,
  )

  const subtotalDecimal =
    booking.subtotalSnapshot ??
    (items.length ? sumDecimal(items.map((item) => item.priceSnapshot)) : null)

  const subtotalLabel = subtotalDecimal ? moneyToString(subtotalDecimal) : null

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

        <Link href={dashboardHref} className="text-[12px] font-black text-textPrimary hover:opacity-80">
          ← Back
        </Link>
      </div>

      {items.length ? (
        <div className="tovis-glass mt-4 rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="text-[12px] font-black text-textSecondary">Service breakdown</div>

          <div className="mt-3 grid gap-2">
            {baseItems.map((item) => {
              const price = moneyToString(item.priceSnapshot) ?? '0.00'
              const mins = Number(item.durationMinutesSnapshot) || 0

              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-card border border-white/10 bg-bgPrimary/35 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-black text-textPrimary">
                      {item.service.name}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-textSecondary">
                      {mins} min
                    </div>
                  </div>

                  <div className="shrink-0 text-[12px] font-black text-textPrimary">
                    ${price}
                  </div>
                </div>
              )
            })}
          </div>

          {addOnItems.length ? (
            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="text-[12px] font-black text-textSecondary">Add-ons</div>

              <div className="mt-3 grid gap-2">
                {addOnItems.map((item) => {
                  const price = moneyToString(item.priceSnapshot) ?? '0.00'
                  const mins = Number(item.durationMinutesSnapshot) || 0

                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-card border border-white/10 bg-bgPrimary/35 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-black text-textPrimary">
                          {item.service.name}
                        </div>
                        <div className="mt-1 text-[11px] font-semibold text-textSecondary">
                          +{mins} min
                        </div>
                      </div>

                      <div className="shrink-0 text-[12px] font-black text-textPrimary">
                        ${price}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="tovis-glass-soft mt-3 rounded-card border border-white/10 px-4 py-3 text-[12px] font-semibold text-textSecondary">
                Add-ons total:{' '}
                <span className="font-black text-textPrimary">
                  ${moneyToString(addOnPrice) ?? '0.00'}
                </span>{' '}
                · Time:{' '}
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
            href={dashboardHref}
            className="rounded-full border border-white/10 bg-bgPrimary px-4 py-3 text-center text-[13px] font-black text-textPrimary hover:border-white/20"
          >
            {dashboardLabel}
          </Link>

          <div className="text-[12px] text-textSecondary">
            Screenshot this if you’re the type to forget things. Statistically speaking: you are.
          </div>
        </div>
      </div>

      {service?.category?.name ? (
        <div className="mt-4 text-[12px] text-textSecondary">
          Category: <span className="font-black text-textPrimary">{service.category.name}</span>
        </div>
      ) : null}
    </main>
  )
}