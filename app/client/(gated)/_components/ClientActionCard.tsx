// app/client/(gated)/_components/ClientActionCard.tsx
import Link from 'next/link'

import type {
  ClientHomeAction,
  ClientHomeBooking,
} from '../_data/getClientHomeData'
import { bookingTitle } from './bookingDisplay'
import {
  firstWord,
  formatDateTime,
  gradientAvatar,
  money,
  professionalName,
} from './homeVisuals'

type AftercarePaymentAction = Extract<
  ClientHomeAction,
  { kind: 'AFTERCARE_PAYMENT_DUE' }
>

function PendingConsultationCard({ booking }: { booking: ClientHomeBooking }) {
  const proName = professionalName(booking.professional)
  const proFirst = firstWord(proName)
  const proposedTotal = money(booking.consultationApproval?.proposedTotal ?? null)
  const wasTotal = money(booking.totalAmount)
  const notes = booking.consultationApproval?.notes?.trim() || null
  const href = `/client/bookings/${encodeURIComponent(booking.id)}?step=consult`

  return (
    <section className="px-4">
      <div className="rounded-card border border-l-[3px] border-textPrimary/10 border-l-gold bg-bgSurface p-[18px] shadow-[0_16px_40px_rgb(var(--shadow-color)/0.14)]">
        <div className="mb-3.5 flex items-center gap-2.5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="5" y="4" width="14" height="17" rx="2.5" />
              <path d="M9 4.5h6V7H9z" />
              <path d="M9 12.5l2 2 4-4" />
            </svg>
          </div>
          <span className="rounded-full border border-gold px-2.5 py-[3px] font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-gold">
            Action needed
          </span>
        </div>

        <h3 className="mb-1.5 font-display text-[18px] font-semibold tracking-[-0.015em] text-textPrimary">
          {proFirst} sent a consultation to review
        </h3>
        <p className="mb-3.5 text-[13.5px] leading-relaxed text-textSecondary">
          {notes ??
            'Your pro reviewed your details and proposed an updated plan. Approve it before your appointment.'}
        </p>

        {proposedTotal ? (
          <div className="mb-3.5 flex items-center justify-between rounded-[13px] border border-textPrimary/10 bg-[rgb(var(--surface-glass)/0.05)] px-3.5 py-[11px]">
            <div>
              <div className="font-display text-[13px] font-bold text-textPrimary">
                New total
              </div>
              {wasTotal ? (
                <div className="mt-0.5 font-mono text-[10.5px] text-textMuted/70">
                  Was {wasTotal}
                </div>
              ) : null}
            </div>
            <span className="font-display text-[22px] font-bold text-gold">
              {proposedTotal}
            </span>
          </div>
        ) : null}

        <Link
          href={href}
          className="flex h-[46px] items-center justify-center rounded-[14px] bg-cta font-display text-[14px] font-bold text-onCta shadow-[0_6px_20px_rgb(var(--micro-accent)/0.28)] transition hover:opacity-95"
        >
          Review &amp; approve →
        </Link>
        <div className="mt-2.5 text-center">
          <Link
            href={`${href}&decision=decline`}
            className="font-display text-[12.5px] font-semibold text-textMuted transition hover:text-textSecondary"
          >
            Decline{wasTotal ? ` · keep my ${wasTotal} booking` : ''}
          </Link>
        </div>
      </div>
    </section>
  )
}

function AftercarePaymentCard({ action }: { action: AftercarePaymentAction }) {
  const { aftercare, booking } = action
  const title = bookingTitle(booking)
  const proName = professionalName(booking.professional)
  const due = money(booking.totalAmount)
  const notes = aftercare.notes?.trim() || null
  const when = formatDateTime(
    booking.scheduledFor,
    booking.locationTimeZone ?? booking.location?.timeZone ?? booking.professional.timeZone,
  )
  const place = booking.location?.name ?? booking.professional.location ?? null
  const href = `/client/bookings/${encodeURIComponent(booking.id)}?step=aftercare`

  return (
    <section className="px-4">
      <div className="rounded-card border border-l-[3px] border-textPrimary/10 border-l-terra bg-bgSurface p-[18px] shadow-[0_16px_40px_rgb(var(--shadow-color)/0.14)]">
        <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-terra/15 text-terra">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
              <path d="M9.5 8h5M9.5 12h5" />
            </svg>
          </div>
          <span className="rounded-full border border-terra px-2.5 py-[3px] font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-terra">
            Summary ready
          </span>
          {due ? (
            <span className="rounded-full bg-gold/15 px-2.5 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-gold">
              {due} due
            </span>
          ) : null}
        </div>

        <h3 className="mb-1.5 font-display text-[18px] font-semibold tracking-[-0.015em] text-textPrimary">
          Your aftercare summary is ready
        </h3>
        <p className="mb-3.5 text-[13.5px] leading-relaxed text-textSecondary">
          {notes ??
            'Before & after, care notes, and your receipt are waiting. Settle the balance to close it out.'}
        </p>

        <div className="mb-3.5 flex items-center gap-3 rounded-[13px] border border-textPrimary/10 bg-[rgb(var(--surface-glass)/0.05)] px-3.5 py-[11px]">
          <div
            className="h-[38px] w-[38px] shrink-0 rounded-[11px]"
            style={{ background: gradientAvatar(0) }}
          />
          <div className="min-w-0">
            <div className="truncate font-display text-[14px] font-semibold text-textPrimary">
              {title} with {proName}
            </div>
            {when ? (
              <div className="mt-0.5 truncate font-mono text-[10.5px] tracking-[0.04em] text-textMuted">
                {when}
                {place ? ` · ${place}` : ''}
              </div>
            ) : null}
          </div>
        </div>

        <Link
          href={href}
          className="flex h-[46px] items-center justify-center rounded-[14px] bg-cta font-display text-[14px] font-bold text-onCta shadow-[0_6px_20px_rgb(var(--accent-primary)/0.26)] transition hover:opacity-95"
        >
          View summary{due ? ` & pay ${due}` : ''} →
        </Link>
      </div>
    </section>
  )
}

export default function ClientActionCard({ action }: { action: ClientHomeAction }) {
  if (!action) return null

  if (action.kind === 'PENDING_CONSULTATION') {
    return <PendingConsultationCard booking={action.booking} />
  }

  return <AftercarePaymentCard action={action} />
}
