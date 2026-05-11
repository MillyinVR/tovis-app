// app/client/components/PastBookings.tsx
'use client'

import type { ReactNode } from 'react'
import type { BookingLike } from './_helpers'
import { prettyWhen, bookingLocationLabel, statusUpper } from './_helpers'
import ProProfileLink from './ProProfileLink'
import CardLink from './CardLink'
import { cn } from '@/lib/utils'

type PastBookingDisplay = {
  coverUrl?: string | null
  imageUrl?: string | null
}

type PastBookingService = {
  imageUrl?: string | null
}

type PastBookingExtras = BookingLike & {
  display?: BookingLike['display'] & PastBookingDisplay
  service?: PastBookingService | null
  serviceDefaultImageUrl?: string | null
  hasUnreadAftercare?: boolean | null
  hasAftercare?: boolean | null
  aftercareId?: string | null
  aftercareSummaryId?: string | null
}

function statusLabel(statusRaw: unknown) {
  const s = statusUpper(statusRaw)

  if (s === 'COMPLETED') return 'Reservation completed'
  if (s === 'CANCELLED') return 'Reservation cancelled'
  if (s === 'ACCEPTED') return 'Reservation confirmed'
  if (s === 'PENDING') return 'Reservation requested'

  return s ? `Reservation ${s.toLowerCase()}` : 'Reservation'
}

function SoftPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'success'
}) {
  const cls =
    tone === 'accent'
      ? 'border-accentPrimary/35 bg-accentPrimary/15 text-textPrimary'
      : tone === 'success'
        ? 'border-toneSuccess/35 bg-toneSuccess/15 text-textPrimary'
        : 'border-white/10 bg-bgPrimary/35 text-textPrimary'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black backdrop-blur',
        cls,
      )}
    >
      {children}
    </span>
  )
}

function ActionPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-accentPrimary px-3 py-1.5 text-[11px] font-black text-bgPrimary">
      {label}
    </span>
  )
}

function normalizeOptionalUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function bookingCoverUrl(booking: PastBookingExtras): string | null {
  return (
    normalizeOptionalUrl(booking.display?.coverUrl) ??
    normalizeOptionalUrl(booking.display?.imageUrl) ??
    normalizeOptionalUrl(booking.service?.imageUrl) ??
    normalizeOptionalUrl(booking.serviceDefaultImageUrl)
  )
}

export default function PastBookings({ items }: { items: BookingLike[] }) {
  const list: PastBookingExtras[] = items

  return (
    <div className="grid gap-3">
      <div className="text-sm font-black text-textPrimary">Past</div>

      {list.map((booking) => {
        const svc =
          booking.display?.title || booking.display?.baseName || 'Appointment'

        const proLabel = booking.professional?.businessName || 'Professional'
        const proId = booking.professional?.id || null

        const when = prettyWhen(booking.scheduledFor, booking.timeZone)
        const loc = bookingLocationLabel(booking)

        const hasUnreadAftercare = Boolean(booking.hasUnreadAftercare)
        const hasAnyAftercare = Boolean(
          booking.hasAftercare ||
            booking.aftercareId ||
            booking.aftercareSummaryId,
        )

        const cover = bookingCoverUrl(booking)

        const href = `/client/bookings/${encodeURIComponent(booking.id)}`
        const aftercareHref = `/client/aftercare/${encodeURIComponent(
          booking.id,
        )}`

        return (
          <CardLink key={booking.id} href={href} className="block no-underline">
            <div className="overflow-hidden rounded-card border border-white/10 bg-bgSecondary">
              <div className="relative">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cover}
                    alt=""
                    className="h-28 w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-28 w-full bg-bgPrimary" />
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-bgPrimary/85 via-bgPrimary/35 to-transparent" />

                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-black text-textPrimary">
                      {svc}
                    </div>
                    <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">
                      {when}
                    </div>
                  </div>

                  {hasAnyAftercare ? (
                    <span
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                    >
                      <a
                        href={aftercareHref}
                        className="inline-flex items-center gap-2 rounded-full border border-accentPrimary/35 bg-bgPrimary/55 px-3 py-2 text-[12px] font-black text-textPrimary backdrop-blur hover:border-accentPrimary/55"
                        style={{ textDecoration: 'none' }}
                      >
                        <span className="whitespace-nowrap">
                          {hasUnreadAftercare
                            ? 'New care plan'
                            : 'View care plan'}
                        </span>
                        <span className="text-textSecondary">→</span>
                      </a>
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="p-3">
                <div className="text-[13px] text-textPrimary">
                  <span
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <ProProfileLink
                      proId={proId}
                      label={proLabel}
                      className="font-black"
                    />
                  </span>
                  {loc ? (
                    <span className="text-textSecondary"> · {loc}</span>
                  ) : null}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SoftPill>{statusLabel(booking.status)}</SoftPill>

                  {hasAnyAftercare ? (
                    <SoftPill tone={hasUnreadAftercare ? 'accent' : 'neutral'}>
                      {hasUnreadAftercare
                        ? 'Unread aftercare'
                        : 'Aftercare available'}
                    </SoftPill>
                  ) : null}

                  {hasUnreadAftercare ? <ActionPill label="Open" /> : null}
                </div>
              </div>
            </div>
          </CardLink>
        )
      })}
    </div>
  )
}