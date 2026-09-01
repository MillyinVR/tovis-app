// app/(main)/booking/AvailabilityDrawer/components/SheetCover.tsx
'use client'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { formatCompactCount } from '@/lib/format/compactCount'
import { formatRoundedDollars } from '@/lib/money'
import type { AvailabilityCover, AvailabilityTrust } from '../types'

/**
 * The top of the booking sheet, to `BookingSheetFrame`: the look you are
 * booking as a photo cover, then the service line, then the reassurance chips.
 *
 * Every chip is omitted when its signal is unknown rather than rendered as a
 * zero or a placeholder — see `lib/booking/trustSignals`. That means the row can
 * legitimately come out empty (a brand-new pro with no reviews and no completed
 * bookings), which is the honest result, so the row itself is not rendered at
 * all when nothing survives.
 */

function formatBookedCount(n: number): string {
  // "1.2K booked" past a thousand, as the frame shows; exact below that, because
  // "0.9K" is a worse read than "912" — which is what `formatCompactCount` does,
  // and it is the app's one abbreviation rule. This used to be a sixth
  // hand-rolled copy of it, differing only in emitting a lowercase "k".
  return `${formatCompactCount(n)} booked`
}

function Chip({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode
  tone?: 'muted' | 'accent'
}) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-[9px] py-1 text-[10.5px] font-semibold tracking-[0.02em]',
        tone === 'accent'
          ? 'border-accentPrimary/35 bg-accentPrimary/10 text-accentPrimary'
          : 'border-textPrimary/10 bg-textPrimary/[0.035] text-textSecondary',
      ].join(' ')}
    >
      {children}
    </span>
  )
}

export function TrustRow({ trust }: { trust: AvailabilityTrust }) {
  const chips: React.ReactNode[] = []

  if (trust.verified) {
    chips.push(
      <Chip key="verified" tone="accent">
        <span aria-hidden="true">✓</span> Verified pro
      </Chip>,
    )
  }

  if (trust.completedBookings != null) {
    chips.push(<Chip key="booked">{formatBookedCount(trust.completedBookings)}</Chip>)
  }

  // A pro who charges no late-cancel fee has no window to state — cancelling is
  // simply free, which is a stronger claim, not a missing one.
  chips.push(
    <Chip key="cancel">
      {trust.freeCancellationHours != null
        ? `Free cancel ${trust.freeCancellationHours}h`
        : 'Free cancellation'}
    </Chip>,
  )

  if (!chips.length) return null

  return (
    <div
      data-testid="booking-trust-row"
      className="mt-3 flex flex-wrap items-center gap-[6px]"
    >
      {chips}
    </div>
  )
}

export default function SheetCover({
  cover,
  trust,
  title,
  proName,
  proAvatarUrl,
  proHref,
  priceStartingAt,
  durationMinutes,
  onClose,
  closeDisabled,
}: {
  cover: AvailabilityCover | null
  trust: AvailabilityTrust
  /**
   * The fallback title when the look has no name of its own. Composed by the
   * DRAWER, not here: on the consult path it is the brand copy table's
   * "book this look" wording, and on the named-service path it is the service
   * name the client picked. This component renders whichever it was handed.
   */
  title: string | null
  proName: string
  proAvatarUrl: string | null
  proHref: string
  priceStartingAt: string | null
  durationMinutes: number | null
  onClose: () => void
  closeDisabled: boolean
}) {
  const price = formatRoundedDollars(priceStartingAt)
  const hasCover = Boolean(cover?.imageUrl)

  return (
    <div>
      {/* COVER — the look, so the sheet is visibly about the thing you tapped.
          Without one (a booking started from a pro's profile) the header
          collapses to a plain bar rather than an empty photo well. */}
      <div
        className={[
          'relative w-full overflow-hidden',
          hasCover ? 'h-[96px] sm:h-[132px]' : 'h-[48px]',
        ].join(' ')}
      >
        {hasCover && cover?.imageUrl ? (
          <>
            <RemoteImage
              src={cover.imageUrl}
              alt={cover.lookName ?? ''}
              className="absolute inset-0 block h-full w-full object-cover"
              width={780}
              height={264}
            />
            {/* Scrim: the sheet body is bgPrimary, so fade INTO it at the bottom
                rather than to a fixed colour that would band in one mode. */}
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(to top, rgb(var(--bg-primary)) 3%, rgb(var(--bg-primary) / 0.05) 58%, rgb(0 0 0 / 0.45) 100%)',
              }}
            />
            {/* ⚠️ `textPrimary`, not white. The eyebrow sits at the very bottom
                of the scrim, where the gradient is ~90% `bgPrimary` — i.e. on
                the SHEET's surface, not on the photo. White there is white on
                near-white in light mode: legible in the dark theme this was
                built in, and all but invisible in the other one. */}
            <div className="absolute bottom-[8px] left-4 flex items-center gap-[6px]">
              <span
                aria-hidden="true"
                className="text-[11px] leading-none text-accentPrimary"
              >
                ◆
              </span>
              <span className="text-[10px] font-black uppercase tracking-[0.13em] text-textPrimary">
                Booking this look
              </span>
            </div>
          </>
        ) : null}

        <button
          type="button"
          data-testid="availability-close-button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label="Close"
          className={[
            'tap-target-keep absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-[14px] transition',
            hasCover
              ? 'bg-black/45 text-white hover:bg-black/60'
              : 'border border-textPrimary/10 bg-bgPrimary/35 text-textSecondary hover:bg-textPrimary/10',
          ].join(' ')}
        >
          ✕
        </button>
      </div>

      {/* SUMMARY + TRUST */}
      <div className="px-5 pb-1 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[19px] font-black leading-tight tracking-[-0.02em] text-textPrimary">
              {cover?.lookName ?? title ?? 'Book an appointment'}
            </div>

            <div className="mt-[5px] flex items-center gap-[7px]">
              <a href={proHref} className="shrink-0 no-underline">
                <span className="block h-[18px] w-[18px] overflow-hidden rounded-full border border-textPrimary/10 bg-bgPrimary/40">
                  {proAvatarUrl ? (
                    <RemoteImage
                      src={proAvatarUrl}
                      alt=""
                      className="block h-full w-full object-cover"
                      width={18}
                      height={18}
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-[9px] font-black text-textSecondary">
                      {(proName || 'P').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
              </a>
              <span className="truncate text-[12.5px] font-medium text-textSecondary">
                with {proName}
              </span>
              {trust.rating ? (
                <span className="shrink-0 text-[12px] font-black text-toneWarn">
                  {trust.rating.average.toFixed(1)}★
                </span>
              ) : null}
            </div>
          </div>

          {price || durationMinutes ? (
            <div className="shrink-0 text-right">
              {price ? (
                <div className="text-[15px] font-black tracking-[-0.02em] text-textPrimary">
                  {/* Prices are STARTING prices — never a bare figure. */}
                  From {price}
                </div>
              ) : null}
              {durationMinutes ? (
                <div className="mt-[2px] text-[10px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                  {durationMinutes} min
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <TrustRow trust={trust} />
      </div>
    </div>
  )
}
