// app/_components/booking/MoneyTrailInspector.tsx
'use client'

// Phase 2.5 refund inspector. One trustworthy view of a booking's money trail —
// the final-bill charge, deposit, discovery fee, no-show / late-cancel fee, and
// every refund row — plus the controlled refund + no-show-fee-waive actions. The
// same component serves pros (their own bookings) and admins (any booking); the
// server decides what's shown/allowed via the /money-trail capability flags, so
// this component never re-derives money rules — it renders them.

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BookingDepositStatus,
  BookingRefundStatus,
  NoShowFeeReason,
  NoShowFeeStatus,
  StripePaymentStatus,
} from '@prisma/client'

import type { BookingMoneyTrail } from '@/lib/booking/moneyTrail'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'
import { formatCents } from '@/lib/money'
import { formatRelativeTimeAgo } from '@/lib/time'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'

type Props = {
  bookingId: string
  /** Heading copy; defaults to "Money trail". */
  heading?: string
}

type Tone = 'success' | 'danger' | 'warn' | 'info' | 'muted'

type TrailEntry = {
  key: string
  label: string
  detail: string | null
  amount: string | null
  /** 'in' = money to the pro, 'out' = money returned to the client. */
  flow: 'in' | 'out' | 'none'
  tone: Tone
  status: string
  at: string | null
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function money(cents: number | null, currency: string): string | null {
  if (cents == null) return null
  return formatCents(cents, { currency, style: 'symbol' })
}

/** Dollars string → integer cents, or null for blank (= full refund). */
function parseAmountToCents(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const dollars = Number(trimmed)
  if (!Number.isFinite(dollars) || dollars <= 0) return 'invalid'
  return Math.round(dollars * 100)
}

const TONE_TEXT: Record<Tone, string> = {
  success: 'text-toneSuccess',
  danger: 'text-toneDanger',
  warn: 'text-toneWarn',
  info: 'text-toneInfo',
  muted: 'text-textMuted',
}

const TONE_DOT: Record<Tone, string> = {
  success: 'border-toneSuccess/30 bg-toneSuccess/10 text-toneSuccess',
  danger: 'border-toneDanger/30 bg-toneDanger/10 text-toneDanger',
  warn: 'border-toneWarn/30 bg-toneWarn/10 text-toneWarn',
  info: 'border-toneInfo/30 bg-toneInfo/10 text-toneInfo',
  muted: 'border-white/10 bg-bgPrimary text-textMuted',
}

function depositStatusTone(status: BookingDepositStatus): Tone {
  switch (status) {
    case BookingDepositStatus.PAID:
      return 'success'
    case BookingDepositStatus.REFUNDED:
      return 'muted'
    case BookingDepositStatus.PENDING:
      // Not yet collected — must NOT read as money received (green). A deposit
      // whose checkout was never completed sits here indefinitely (see M5).
      return 'warn'
    case BookingDepositStatus.FAILED:
      return 'danger'
    default:
      return 'muted'
  }
}

function refundStatusTone(status: BookingRefundStatus): Tone {
  switch (status) {
    case BookingRefundStatus.SUCCEEDED:
      return 'success'
    case BookingRefundStatus.FAILED:
    case BookingRefundStatus.CANCELED:
      return 'danger'
    default:
      return 'warn'
  }
}

function noShowReasonLabel(reason: NoShowFeeReason | null): string {
  if (reason === NoShowFeeReason.NO_SHOW) return 'No-show'
  if (reason === NoShowFeeReason.LATE_CANCEL) return 'Late cancel'
  return 'No-show fee'
}

function noShowStatusTone(status: NoShowFeeStatus): Tone {
  switch (status) {
    case NoShowFeeStatus.CHARGED:
      return 'success'
    case NoShowFeeStatus.FAILED:
      return 'danger'
    case NoShowFeeStatus.WAIVED:
      return 'muted'
    default:
      return 'muted'
  }
}

/** Flatten the structured trail into an ordered display timeline. */
function buildEntries(trail: BookingMoneyTrail): TrailEntry[] {
  const { currency } = trail
  const entries: TrailEntry[] = []

  if (trail.deposit) {
    const d = trail.deposit
    // A disputed deposit has had its funds pulled by Stripe even though
    // depositStatus still reads PAID (the deposit rides its own PaymentIntent).
    // It must read as money at risk, not money safely received — mirroring how
    // the final-bill charge renders DISPUTED below.
    const disputed = d.disputedAt != null
    // Money is only "in" once the deposit was actually captured (PAID, or PAID
    // then partially/fully refunded) AND is not under dispute. A PENDING deposit
    // whose checkout was never completed has collected nothing — it must not
    // render as green money-in either.
    const captured =
      !disputed &&
      (d.status === BookingDepositStatus.PAID ||
        d.status === BookingDepositStatus.REFUNDED)
    entries.push({
      key: 'deposit',
      label: 'Deposit',
      detail: disputed
        ? 'Payment disputed'
        : d.refundedCents > 0
          ? `${money(d.refundedCents, currency)} refunded`
          : d.creditedAt
            ? 'Credited to the final total'
            : d.status === BookingDepositStatus.PENDING
              ? 'Unpaid — deposit checkout not completed'
              : null,
      amount: money(d.amountCents, currency),
      flow: captured ? 'in' : 'none',
      tone: disputed ? 'danger' : depositStatusTone(d.status),
      status: disputed ? 'DISPUTED' : d.status,
      at: d.paidAt,
    })
  }

  if (trail.finalCharge) {
    const c = trail.finalCharge
    const paid = c.status === StripePaymentStatus.SUCCEEDED
    entries.push({
      key: 'final-charge',
      label: 'Final bill',
      detail: c.status === StripePaymentStatus.DISPUTED ? 'Payment disputed' : null,
      amount: money(c.capturedCents, currency),
      flow: 'in',
      tone: paid ? 'success' : c.status === StripePaymentStatus.DISPUTED ? 'danger' : 'warn',
      status: c.status,
      at: c.paidAt,
    })
  }

  if (trail.discoveryFee) {
    const f = trail.discoveryFee
    entries.push({
      key: 'discovery-fee',
      label: 'Platform discovery fee',
      detail: f.refundedAt ? 'Refunded' : null,
      amount: money(f.amountCents, currency),
      flow: 'none',
      tone: f.refundedAt ? 'muted' : 'info',
      status: f.refundedAt ? 'REFUNDED' : 'CHARGED',
      at: null,
    })
  }

  if (trail.noShowFee) {
    const n = trail.noShowFee
    entries.push({
      key: 'no-show-fee',
      label: `${noShowReasonLabel(n.reason)} fee`,
      detail:
        n.status === NoShowFeeStatus.FAILED
          ? 'Charge failed — card declined'
          : n.status === NoShowFeeStatus.WAIVED
            ? 'Waived'
            : n.status === NoShowFeeStatus.SKIPPED
              ? 'Not charged'
              : null,
      amount: money(n.amountCents, currency),
      flow: n.status === NoShowFeeStatus.CHARGED ? 'in' : 'none',
      tone: noShowStatusTone(n.status),
      status: n.status,
      at: n.chargedAt ?? n.markedAt,
    })
  }

  for (const r of trail.refunds) {
    entries.push({
      key: `refund-${r.id}`,
      label: 'Refund',
      // A FAILED refund's most important fact is WHY it failed — the money never
      // reached the client and someone must act. Surface the Stripe failure
      // message (falling back to the request reason, then a generic label) rather
      // than the request reason alone, which reads as if the refund succeeded.
      detail:
        r.status === BookingRefundStatus.FAILED
          ? (r.failureMessage ?? r.reason ?? 'Refund failed')
          : (r.reason ??
            (r.trigger === 'AUTO_CANCELLATION'
              ? 'Automatic (cancellation)'
              : null)),
      amount: money(r.amountCents, r.currency.toLowerCase()),
      flow: 'out',
      tone: refundStatusTone(r.status),
      status: r.status,
      at: r.createdAt,
    })
  }

  return entries
}

function StatChip({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className="rounded-xl border border-white/10 bg-bgPrimary px-3 py-2.5">
      <div className="font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-textMuted">
        {label}
      </div>
      <div className={`mt-0.5 font-display text-[16px] font-bold ${TONE_TEXT[tone]}`}>
        {value}
      </div>
    </div>
  )
}

const btnBase =
  'inline-flex items-center justify-center rounded-full px-3 py-2 text-[12px] font-black transition ' +
  'disabled:cursor-not-allowed disabled:opacity-60 border border-white/10'

export default function MoneyTrailInspector({ bookingId, heading }: Props) {
  const [trail, setTrail] = useState<BookingMoneyTrail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [refundOpen, setRefundOpen] = useState(false)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoadError(null)

    try {
      const res = await fetch(
        `/api/v1/bookings/${encodeURIComponent(bookingId)}/money-trail`,
        { signal: controller.signal, headers: { Accept: 'application/json' } },
      )
      const data: unknown = await safeJson(res)

      if (
        !res.ok ||
        !isRecord(data) ||
        typeof data.trail !== 'object' ||
        data.trail === null
      ) {
        setLoadError(
          res.status === 404
            ? 'Booking not found.'
            : `Could not load the money trail (${res.status}).`,
        )
        return
      }

      // Narrowed to a non-null object above → a single structural downcast, no
      // double-cast escape hatch (house rule: no type escapes).
      setTrail(data.trail as BookingMoneyTrail)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setLoadError('Network error while loading the money trail.')
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setLoading(false)
      }
    }
  }, [bookingId])

  useEffect(() => {
    void load()
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [load])

  async function submitRefund() {
    if (actionPending || !trail) return

    const cents = parseAmountToCents(refundAmount)
    if (cents === 'invalid') {
      setActionError('Enter a positive amount, or leave blank to refund in full.')
      return
    }

    const remaining = trail.capabilities.refundableRemainingCents
    const fullLabel = money(remaining, trail.currency)
    const confirmCopy =
      cents === null
        ? `Refund the remaining ${fullLabel} to the client? This cannot be undone.`
        : `Refund ${money(cents, trail.currency)} to the client? This cannot be undone.`
    if (typeof window !== 'undefined' && !window.confirm(confirmCopy)) return

    setActionError(null)
    setActionPending(true)

    try {
      // Strict action-only key: a double-submit within the bucket replays the
      // first refund instead of issuing a second one. The server hashes the
      // refund details, so a different amount under the same key 409s. Built
      // inside the try so a throw can't strand the pending flag.
      const key = buildClientIdempotencyKey({
        scope: 'money-trail',
        entityId: bookingId,
        action: 'refund',
      })

      const res = await fetch(
        `/api/v1/bookings/${encodeURIComponent(bookingId)}/refund`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...idempotencyHeaders(key),
          },
          body: JSON.stringify({
            ...(cents !== null ? { amountCents: cents } : {}),
            ...(refundReason.trim() ? { reason: refundReason.trim() } : {}),
          }),
        },
      )
      const data: unknown = await safeJson(res)

      if (!res.ok) {
        const root = isRecord(data) ? data : null
        setActionError(
          (root ? readString(root.error) : null) ??
            `Refund failed (${res.status}).`,
        )
        return
      }

      setFlash('Refund issued.')
      setRefundOpen(false)
      setRefundAmount('')
      setRefundReason('')
      await load()
    } catch {
      setActionError('Network error while issuing the refund.')
    } finally {
      setActionPending(false)
    }
  }

  async function waiveNoShow() {
    if (actionPending) return
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Waive this no-show fee? The client will not be charged.')
    ) {
      return
    }

    setActionError(null)
    setActionPending(true)

    try {
      const key = buildClientIdempotencyKey({
        scope: 'money-trail',
        entityId: bookingId,
        action: 'waive',
      })

      const res = await fetch(
        `/api/v1/bookings/${encodeURIComponent(bookingId)}/no-show-fee/waive`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...idempotencyHeaders(key),
          },
          body: '{}',
        },
      )
      const data: unknown = await safeJson(res)

      if (!res.ok) {
        const root = isRecord(data) ? data : null
        setActionError(
          (root ? readString(root.error) : null) ??
            `Waive failed (${res.status}).`,
        )
        return
      }

      setFlash('No-show fee waived.')
      await load()
    } catch {
      setActionError('Network error while waiving the fee.')
    } finally {
      setActionPending(false)
    }
  }

  return (
    <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[14px] font-bold text-textPrimary">
            {heading ?? 'Money trail'}
          </h2>
          <div className="mt-0.5 text-[12px] text-textMuted">
            Every charge, fee, and refund on this booking.
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-3 text-[12px] text-textMuted">Loading…</div>
      ) : loadError ? (
        <div className="mt-3 rounded-xl border border-toneDanger/30 bg-toneDanger/10 p-3 text-[12px] font-black text-toneDanger">
          {loadError}
        </div>
      ) : trail ? (
        <>
          {/* summary */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <StatChip
              label="Captured"
              value={money(trail.summary.capturedCents, trail.currency) ?? '—'}
              tone="muted"
            />
            <StatChip
              label="Refunded"
              value={money(trail.summary.refundedCents, trail.currency) ?? '—'}
              tone={trail.summary.refundedCents > 0 ? 'warn' : 'muted'}
            />
            <StatChip
              label="Net to pro"
              value={money(trail.summary.netCents, trail.currency) ?? '—'}
              tone="success"
            />
          </div>

          {/* timeline */}
          <div className="mt-3 flex flex-col">
            {buildEntries(trail).map((e) => (
              <div
                key={e.key}
                className="flex items-center gap-3 border-t border-white/10 py-2.5"
              >
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${TONE_DOT[e.tone]}`}
                >
                  <span className="text-[13px] font-black leading-none">
                    {e.flow === 'out' ? '↩' : e.flow === 'in' ? '↓' : '•'}
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-black text-textPrimary">
                    {e.label}
                    <span
                      className={`font-mono text-[8px] font-bold uppercase tracking-widest ${TONE_TEXT[e.tone]}`}
                    >
                      {e.status}
                    </span>
                  </div>
                  {e.detail || e.at ? (
                    <div className="truncate text-[11px] text-textMuted">
                      {[e.detail, e.at ? formatRelativeTimeAgo(e.at) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  ) : null}
                </div>
                {e.amount ? (
                  <span
                    className={`font-display text-[13px] font-bold ${
                      e.flow === 'out' ? 'text-toneWarn' : 'text-textPrimary'
                    }`}
                  >
                    {e.flow === 'out' ? '−' : ''}
                    {e.amount}
                  </span>
                ) : null}
              </div>
            ))}
            {buildEntries(trail).length === 0 ? (
              <div className="border-t border-white/10 py-3 text-[12px] text-textMuted">
                No money has moved on this booking yet.
              </div>
            ) : null}
          </div>

          {flash ? (
            <div
              aria-live="polite"
              className="mt-3 rounded-xl border border-toneSuccess/30 bg-toneSuccess/10 p-2.5 text-[12px] font-black text-toneSuccess"
            >
              {flash}
            </div>
          ) : null}

          {actionError ? (
            <div
              aria-live="polite"
              className="mt-3 rounded-xl border border-toneDanger/30 bg-toneDanger/10 p-2.5 text-[12px] font-black text-toneDanger"
            >
              {actionError}
            </div>
          ) : null}

          {/* actions */}
          {trail.capabilities.canRefund || trail.capabilities.canWaiveNoShowFee ? (
            <div className="mt-3 border-t border-white/10 pt-3">
              {refundOpen ? (
                <div className="grid gap-2 rounded-2xl border border-white/10 bg-bgPrimary p-3">
                  <label className="grid gap-1 text-[11px] font-black text-textSecondary">
                    Amount ({trail.currency.toUpperCase()})
                    <input
                      inputMode="decimal"
                      value={refundAmount}
                      onChange={(ev) => setRefundAmount(ev.target.value)}
                      placeholder={`Full: ${(
                        trail.capabilities.refundableRemainingCents / 100
                      ).toFixed(2)}`}
                      className="rounded-lg border border-white/10 bg-surfaceGlass px-2 py-1 text-[13px] font-black text-textPrimary"
                    />
                  </label>
                  <label className="grid gap-1 text-[11px] font-black text-textSecondary">
                    Reason (optional)
                    <input
                      value={refundReason}
                      onChange={(ev) => setRefundReason(ev.target.value)}
                      maxLength={500}
                      placeholder="e.g. service issue"
                      className="rounded-lg border border-white/10 bg-surfaceGlass px-2 py-1 text-[13px] font-black text-textPrimary"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={submitRefund}
                      disabled={actionPending}
                      className={`${btnBase} bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover`}
                    >
                      {actionPending ? 'Refunding…' : 'Confirm refund'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRefundOpen(false)
                        setActionError(null)
                      }}
                      disabled={actionPending}
                      className={`${btnBase} bg-bgPrimary text-textPrimary hover:border-white/20`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {trail.capabilities.canRefund ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null)
                        setFlash(null)
                        setRefundOpen(true)
                      }}
                      className={`${btnBase} bg-bgPrimary text-textPrimary hover:border-white/20`}
                    >
                      Refund…
                    </button>
                  ) : null}
                  {trail.capabilities.canWaiveNoShowFee ? (
                    <button
                      type="button"
                      onClick={waiveNoShow}
                      disabled={actionPending}
                      className={`${btnBase} bg-bgPrimary text-textPrimary hover:border-white/20`}
                    >
                      {actionPending ? 'Waiving…' : 'Waive no-show fee'}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
