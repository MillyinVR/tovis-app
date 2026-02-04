// app/client/components/PastBookings.tsx
'use client'

import type { BookingLike } from './_helpers'
import { prettyWhen, bookingLocationLabel, statusUpper } from './_helpers'
import ProProfileLink from './ProProfileLink'
import CardLink from './CardLink'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
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
  children: React.ReactNode
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
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black backdrop-blur',
        cls
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

/**
 * Best-effort cover image:
 * - Prefer booking.display.coverUrl if you have it
 * - else fallback to booking.display.imageUrl / service image field if present
 * - else null (we show a luxe gradient block)
 *
 * If your DTO uses different names, swap here only.
 */
function bookingCoverUrl(b: BookingLike): string | null {
  const anyB = b as any
  const url =
    anyB?.display?.coverUrl ||
    anyB?.display?.imageUrl ||
    anyB?.service?.imageUrl ||
    anyB?.serviceDefaultImageUrl ||
    null

  return typeof url === 'string' && url.trim() ? url.trim() : null
}

export default function PastBookings({ items }: { items: BookingLike[] }) {
  const list = items ?? []

  return (
    <div className="grid gap-3">
      <div className="text-sm font-black text-textPrimary">Past</div>

      {list.map((b) => {
        const svc = b?.display?.title || b?.display?.baseName || 'Appointment'
        const proLabel = b?.professional?.businessName || 'Professional'
        const proId = b?.professional?.id || null

        const when = prettyWhen(b?.scheduledFor, b?.timeZone)
        const loc = bookingLocationLabel(b)

        const hasUnreadAftercare = Boolean((b as any)?.hasUnreadAftercare)
        const hasAnyAftercare = Boolean((b as any)?.hasAftercare || (b as any)?.aftercareId || (b as any)?.aftercareSummaryId)

        const cover = bookingCoverUrl(b)

        const href = `/client/bookings/${encodeURIComponent(b.id)}`
        const aftercareHref = `/client/aftercare/${encodeURIComponent(b.id)}`

        return (
          <CardLink key={b.id} href={href} className="block no-underline">
            <div className="overflow-hidden rounded-card border border-white/10 bg-bgSecondary">
              {/* Cover */}
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

                {/* soft overlay for text legibility */}
                <div className="absolute inset-0 bg-gradient-to-t from-bgPrimary/85 via-bgPrimary/35 to-transparent" />

                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-black text-textPrimary">{svc}</div>
                    <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">{when}</div>
                  </div>

                  {/* Aftercare CTA (only if exists/unread) */}
                  {hasAnyAftercare ? (
                    <span
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <a
                        href={aftercareHref}
                        className="inline-flex items-center gap-2 rounded-full border border-accentPrimary/35 bg-bgPrimary/55 px-3 py-2 text-[12px] font-black text-textPrimary backdrop-blur hover:border-accentPrimary/55"
                        style={{ textDecoration: 'none' }}
                      >
                        <span className="whitespace-nowrap">
                          {hasUnreadAftercare ? 'New care plan' : 'View care plan'}
                        </span>
                        <span className="text-textSecondary">→</span>
                      </a>
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Body */}
              <div className="p-3">
                <div className="text-[13px] text-textPrimary">
                  <span
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <ProProfileLink proId={proId} label={proLabel} className="font-black" />
                  </span>
                  {loc ? <span className="text-textSecondary"> · {loc}</span> : null}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SoftPill>{statusLabel(b?.status)}</SoftPill>

                  {hasAnyAftercare ? (
                    <SoftPill tone={hasUnreadAftercare ? 'accent' : 'neutral'}>
                      {hasUnreadAftercare ? 'Unread aftercare' : 'Aftercare available'}
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
