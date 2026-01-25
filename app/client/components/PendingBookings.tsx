// app/client/components/PendingBookings.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { BookingLike } from './_helpers'
import { prettyWhen, bookingLocationLabel, statusUpper } from './_helpers'
import ProProfileLink from './ProProfileLink'
import CardLink from './CardLink'

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function errorFrom(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function Pill({ children }: { children: React.ReactNode }) {
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

function formatMoneyMaybe(v: string) {
  const s = (v || '').trim()
  if (!s) return ''
  return s.startsWith('$') ? s : `$${s}`
}


export default function PendingBookings({
  items,
  onChanged,
}: {
  items: BookingLike[]
  onChanged?: () => void
}) {
  const list = items ?? []
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const actionRequired = useMemo(() => list.filter((b) => Boolean(b?.hasPendingConsultationApproval)), [list])
  const regularPending = useMemo(() => list.filter((b) => !b?.hasPendingConsultationApproval), [list])

  async function decide(bookingId: string, action: 'approve' | 'reject') {
    if (!bookingId || busyId) return
    setError(null)
    setBusyId(bookingId)

    try {
      const res = await fetch(`/api/client/bookings/${encodeURIComponent(bookingId)}/consultation/${action}`, {
        method: 'POST',
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(errorFrom(res, data))
      onChanged?.()
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.')
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
          <div className="text-xs font-black text-textSecondary">Action required</div>

          {actionRequired.map((b) => {
            const svc = b?.display?.title || b?.display?.baseName || 'Appointment'
            const when = prettyWhen(b?.scheduledFor, b?.timeZone)
            const loc = bookingLocationLabel(b)

            const proId = b?.professional?.id || null
            const proLabel = b?.professional?.businessName || 'Professional'

            const price = b?.consultation?.consultationPrice ?? null
            const isBusy = busyId === b.id

            return (
              <div key={b.id} className="rounded-card border border-white/10 bg-bgPrimary p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-sm font-black text-textPrimary">{svc}</div>
                  <div className="text-xs font-semibold text-textSecondary">{when}</div>
                </div>

                <div className="mt-1 text-sm text-textPrimary">
                  <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                    <ProProfileLink proId={proId} label={proLabel} className="font-black" />
                  </span>
                  {loc ? <span className="text-textSecondary"> · {loc}</span> : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Pill>Action required</Pill>
                  <Pill>Approve consultation</Pill>
                  {price ? <Pill>Proposed: {formatMoneyMaybe(price)}</Pill> : null}

                  <Link
                    href={`/client/bookings/${encodeURIComponent(b.id)}?step=consult`}
                    className="ml-auto inline-flex items-center justify-center rounded-full border border-white/10 bg-accentPrimary px-3 py-2 text-xs font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
                  >
                    Review
                  </Link>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => decide(b.id, 'approve')}
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
                    onClick={() => decide(b.id, 'reject')}
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

      {/* ✅ Regular pending cards: no outer <Link> anymore (so ProProfileLink is safe) */}
      {regularPending.map((b) => {
        const href = `/client/bookings/${encodeURIComponent(b.id)}`
        const svc = b?.display?.title || b?.display?.baseName || 'Appointment'
        const when = prettyWhen(b?.scheduledFor, b?.timeZone)
        const loc = bookingLocationLabel(b)

        const proId = b?.professional?.id || null
        const proLabel = b?.professional?.businessName || 'Professional'

        return (
          <CardLink key={b.id} href={href}>
            <div className="cursor-pointer rounded-card border border-white/10 bg-bgPrimary p-3 text-textPrimary">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-black">{svc}</div>
                <div className="text-xs font-semibold text-textSecondary">{when}</div>
              </div>

              <div className="mt-1 text-sm">
                <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  <ProProfileLink proId={proId} label={proLabel} className="font-black" />
                </span>
                {loc ? <span className="text-textSecondary"> · {loc}</span> : null}
              </div>

              <div className="mt-3">
                <Pill>{statusLabel(b?.status)}</Pill>
              </div>
            </div>
          </CardLink>
        )
      })}

      {list.length === 0 ? <div className="text-sm font-medium text-textSecondary">No pending items.</div> : null}
    </div>
  )
}
