// app/client/_components/UpcomingAppointmentCard.tsx
import Link from 'next/link'

import type { ClientHomeBooking } from '../_data/getClientHomeData'

function formatWhen(date: Date, timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timeZone || undefined,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
}

function money(
  value: { toString(): string } | number | string | null,
): string | null {
  if (value == null) return null
  const numeric =
    typeof value === 'number' ? value : Number.parseFloat(value.toString())
  if (!Number.isFinite(numeric)) return null
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(numeric)
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function professionalName(professional: {
  businessName: string | null
  handle?: string | null
}): string {
  return (
    professional.businessName ??
    professional.handle ??
    'Professional'
  ).trim()
}

function initialsForName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return 'P'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function bookingTitle(booking: ClientHomeBooking): string {
  const serviceItemNames = booking.serviceItems
    .map((item) => item.service?.name?.trim())
    .filter((name): name is string => Boolean(name))
  if (serviceItemNames.length === 1) return serviceItemNames[0]
  if (serviceItemNames.length > 1)
    return `${serviceItemNames[0]} + ${serviceItemNames.length - 1} more`
  return booking.service?.name ?? 'Appointment'
}

function bookingLocation(booking: ClientHomeBooking): string | null {
  return (
    booking.location?.formattedAddress ??
    safeString(booking.locationAddressSnapshot) ??
    booking.location?.city ??
    booking.professional.location ??
    null
  )
}

function bookingTimeZone(booking: ClientHomeBooking): string | null {
  return (
    booking.locationTimeZone ??
    booking.location?.timeZone ??
    booking.professional.timeZone ??
    null
  )
}

function Portrait({ src, alt }: { src: string | null; alt: string }) {
  return (
    <div
      className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden"
      style={{
        borderRadius: 12,
        background:
          'linear-gradient(155deg, #3a2b20 0%, #1a1208 55%, #0a0807 100%)',
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <span className="text-xs font-bold text-textMuted">
          {initialsForName(alt)}
        </span>
      )}
    </div>
  )
}

function EmptyUpcomingCard() {
  return (
    <div className="px-4">
      <div
        className="overflow-hidden border border-textPrimary/16"
        style={{
          borderRadius: 18,
          background:
            'linear-gradient(135deg, rgba(224,90,40,0.08) 0%, rgba(10,9,7,0) 60%)',
        }}
      >
        <div
          className="border-b px-4 py-3.5"
          style={{ borderColor: 'rgba(224,90,40,0.18)' }}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-terra">
            ◆ Nothing booked yet
          </span>
        </div>

        <div className="p-4">
          <div className="flex gap-3">
            <div
              className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden"
              style={{
                borderRadius: 12,
                background:
                  'linear-gradient(155deg, #6b4a3a 0%, #2a1f18 50%, #0a0807 100%)',
              }}
            >
              <span className="text-lg font-bold text-textMuted/40">+</span>
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-textPrimary">
                No approved appointments yet.
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-textMuted">
                When a pro approves your booking, it&apos;ll show up here.
              </p>
              <Link
                href="/discover"
                className="mt-3.5 inline-flex rounded-[10px] border border-textPrimary/16 px-4 py-2 text-[11px] font-bold text-textSecondary transition hover:border-terra/30 hover:text-terra"
              >
                Find a pro
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function UpcomingAppointmentCard({
  booking,
}: {
  booking: ClientHomeBooking | null
}) {
  if (!booking) return <EmptyUpcomingCard />

  const title = bookingTitle(booking)
  const proName = professionalName(booking.professional)
  const location = bookingLocation(booking)
  const timeZone = bookingTimeZone(booking)
  const total = money(booking.totalAmount)
  const when = formatWhen(booking.scheduledFor, timeZone)

  return (
    <div className="px-4">
      <div
        className="overflow-hidden border border-textPrimary/16"
        style={{
          borderRadius: 18,
          background:
            'linear-gradient(135deg, rgba(224,90,40,0.08) 0%, rgba(10,9,7,0) 100%)',
        }}
      >
        <div className="border-b border-textPrimary/8 px-4 py-3.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accentPrimaryHover">
            ◆ Upcoming · {when}
          </span>
        </div>

        <div className="p-4">
          <div className="flex gap-3">
            <Portrait src={booking.professional.avatarUrl} alt={proName} />

            <div className="min-w-0 flex-1">
              <Link
                href={`/client/bookings/${encodeURIComponent(booking.id)}`}
                className="block truncate text-[15px] font-bold text-textPrimary transition hover:opacity-80"
              >
                {title}
              </Link>

              <p className="mt-0.5 truncate text-[12px] text-textSecondary">
                <Link
                  href={`/professionals/${encodeURIComponent(booking.professional.id)}`}
                  className="hover:opacity-80"
                >
                  {proName}
                </Link>
                {location ? ` · ${location}` : ''}
              </p>

              {total && (
                <p className="mt-0.5 text-[12px] text-textMuted">{total}</p>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {(
              [
                { label: 'Directions', suffix: '' },
                { label: 'Message pro', suffix: '?action=message' },
                { label: 'Reschedule', suffix: '?action=reschedule' },
              ] as const
            ).map(({ label, suffix }) => (
              <Link
                key={label}
                href={`/client/bookings/${encodeURIComponent(booking.id)}${suffix}`}
                className="flex items-center justify-center rounded-[10px] border border-textPrimary/16 py-2.5 text-[11px] font-bold text-textSecondary transition hover:border-textPrimary/25"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
