// app/client/components/PendingBookings.tsx
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import type { BookingLike } from './_helpers'
import { prettyWhen, bookingLocationLabel, statusUpper } from './_helpers'
import ProProfileLink from './ProProfileLink'
import CardLink from './CardLink'
import { safeJson } from '@/lib/http'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'

type SafeJsonResponse = {
  error?: unknown
}

type PendingBookingLike = BookingLike & {
  hasPendingConsultationApproval?: boolean | null
  consultation?: {
    consultationPrice?: string | null
  } | null
}

function errorFrom(res: Response, data: unknown): string {
  const parsed = data as SafeJsonResponse | null

  if (typeof parsed?.error === 'string') return parsed.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You don’t have access to do that.'

  return `Request failed (${res.status}).`
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'Something went wrong.'
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-surfaceGlass px-2 py-1 text-[11px] font-black text-textPrimary">
      {children}
    </span>
  )
}

function statusLabel(statusRaw: unknown) {
  const s = statusUpper(statusRaw)

  if (s === 'PENDING') return 'Requested'
  if (s === 'ACCEPTED') return 'Confirmed'

  return s || 'Pending'
}

function formatMoneyMaybe(value: string | null | undefined): string {
  const normalized = value?.trim() ?? ''

  if (!normalized) return ''

  return normalized.startsWith('$') ? normalized : `$${normalized}`
}

export default function PendingBookings({
  items,
  onChanged,
}: {
  items: BookingLike[]
  onChanged?: () => void
}) {
  const list = useMemo<PendingBookingLike[]>(() => items, [items])

  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const actionRequired = useMemo(
    () =>
      list.filter((booking) =>
        Boolean(booking.hasPendingConsultationApproval),
      ),
    [list],
  )

  const regularPending = useMemo(
    () =>
      list.filter(
        (booking) => !booking.hasPendingConsultationApproval,
      ),
    [list],
  )

  async function decide(
    bookingId: string,
    action: 'approve' | 'reject',
  ): Promise<void> {
    if (!bookingId || busyId) return

    setError(null)
    setBusyId(bookingId)

    try {
      const res = await fetch(
        `/api/client/bookings/${encodeURIComponent(
          bookingId,
        )}/consultation/${action}`,
        {
          method: 'POST',
        },
      )

      const data = await safeJson(res)

      if (!res.ok) {
        throw new Error(errorFrom(res, data))
      }

      onChanged?.()
    } catch (caughtError: unknown) {
      setError(errorMessageFromUnknown(caughtError))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="grid gap-2">
      <div className="text-sm font-black text-textPrimary">Pending</div>

      {error ? (
        <div className="rounded-card border border-white/10 bg-surfaceGlass p-3 text-xs font-semibold text-microAccent">
          {error}
        </div>
      ) : null}

      {actionRequired.length ? (
        <div className="grid gap-3">
          <div className="text-xs font-black text-textSecondary">
            Action required
          </div>

          {actionRequired.map((booking) => {
            const svc =
              booking.display?.title ||
              booking.display?.baseName ||
              'Appointment'

            const when = prettyWhen(booking.scheduledFor, booking.timeZone)
            const loc = bookingLocationLabel(booking)

            const proId = booking.professional?.id || null
            const proLabel =
              formatProfessionalPublicDisplayName({ businessName: booking.professional?.businessName })

            const price = booking.consultation?.consultationPrice ?? null
            const formattedPrice = formatMoneyMaybe(price)
            const isBusy = busyId === booking.id

            return (
              <div
                key={booking.id}
                className="rounded-card border border-white/10 bg-bgPrimary p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-sm font-black text-textPrimary">
                    {svc}
                  </div>
                  <div className="text-xs font-semibold text-textSecondary">
                    {when}
                  </div>
                </div>

                <div className="mt-1 text-sm text-textPrimary">
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

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Pill>Action required</Pill>
                  <Pill>Approve consultation</Pill>
                  {formattedPrice ? (
                    <Pill>Proposed: {formattedPrice}</Pill>
                  ) : null}

                  <Link
                    href={`/client/bookings/${encodeURIComponent(
                      booking.id,
                    )}?step=consult`}
                    className="ml-auto inline-flex items-center justify-center rounded-full border border-white/10 bg-accentPrimary px-3 py-2 text-xs font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
                  >
                    Review
                  </Link>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void decide(booking.id, 'approve')
                    }}
                    disabled={isBusy}
                    className={[
                      'rounded-full px-4 py-2 text-xs font-black transition',
                      isBusy
                        ? 'cursor-not-allowed border border-white/10 bg-bgSecondary text-textSecondary'
                        : 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
                    ].join(' ')}
                  >
                    {isBusy ? 'Working…' : 'Approve'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void decide(booking.id, 'reject')
                    }}
                    disabled={isBusy}
                    className={[
                      'rounded-full px-4 py-2 text-xs font-black transition',
                      isBusy
                        ? 'cursor-not-allowed border border-white/10 bg-bgSecondary text-textSecondary'
                        : 'border border-white/10 bg-bgSecondary text-textPrimary hover:bg-surfaceGlass',
                    ].join(' ')}
                  >
                    Reject
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {regularPending.map((booking) => {
        const href = `/client/bookings/${encodeURIComponent(booking.id)}`
        const svc =
          booking.display?.title ||
          booking.display?.baseName ||
          'Appointment'

        const when = prettyWhen(booking.scheduledFor, booking.timeZone)
        const loc = bookingLocationLabel(booking)

        const proId = booking.professional?.id || null
        const proLabel =
          formatProfessionalPublicDisplayName({ businessName: booking.professional?.businessName })

        return (
          <CardLink key={booking.id} href={href}>
            <div className="cursor-pointer rounded-card border border-white/10 bg-bgPrimary p-3 text-textPrimary">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-black">{svc}</div>
                <div className="text-xs font-semibold text-textSecondary">
                  {when}
                </div>
              </div>

              <div className="mt-1 text-sm">
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

              <div className="mt-3">
                <Pill>{statusLabel(booking.status)}</Pill>
              </div>
            </div>
          </CardLink>
        )
      })}

      {list.length === 0 ? (
        <div className="text-sm font-medium text-textSecondary">
          No pending items.
        </div>
      ) : null}
    </div>
  )
}