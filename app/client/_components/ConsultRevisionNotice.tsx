'use client'

// app/client/_components/ConsultRevisionNotice.tsx
//
// Book the Look, B6 — what the client reads when her pro's number has moved
// past the threshold Tori set on 2026-08-31.
//
// ONE component for BOTH places she can answer a proposal — her own booking
// page and the emailed consultation link — so the two can never come to
// describe the same change differently. It takes no props but the notice for
// that reason: the two surfaces have nothing to differ about.
//
// It renders NOTHING when the change is not big. The threshold decision is the
// server's (lib/consult/inChairFinalization.ts) and is not re-litigated here —
// a second opinion about whether a price moved is exactly the drift this slice
// exists to remove.
//
// 🔴 There is no CANCEL button here, and its absence is deliberate. Tori's
// decision pairs this notice with a cancel-for-full-refund option; a client
// cannot cancel this booking today, because the proposal route refuses until
// the appointment has been STARTED and IN_PROGRESS → CANCELLED is admin-only
// under the M8 lifecycle contract. A button that 409s would be worse than none,
// so the copy names the escape that actually works — she says no, and the pro
// makes a recorded keep-or-refund call on her deposit.

import { COPY } from '@/lib/copy'
import type { ConsultRevisionNotice as ConsultRevisionNoticeData } from '@/lib/consult/inChairFinalization'
import { formatCents } from '@/lib/money'

function minutesLabel(minutes: number): string {
  return `${minutes} min`
}

export default function ConsultRevisionNotice({
  notice,
}: {
  notice: ConsultRevisionNoticeData | null
}) {
  if (!notice?.bigChange) return null

  const showPrice = notice.reasons.includes('PRICE')
  const showDuration = notice.reasons.includes('DURATION')

  return (
    <div className="mt-3 rounded-card border border-toneWarn/30 bg-toneWarn/10 p-3">
      <div className="text-sm font-black text-toneWarn">
        {COPY.consultRevisionNotice.title}
      </div>

      <div className="mt-2 grid gap-1 text-[13px] font-semibold text-textPrimary">
        {showPrice ? (
          <div>
            {COPY.consultRevisionNotice.priceLead}{' '}
            {COPY.consultRevisionNotice.bookedLabel}{' '}
            {formatCents(notice.committedPriceCents)},{' '}
            {COPY.consultRevisionNotice.nowLabel}{' '}
            {formatCents(notice.finalPriceCents)}.
          </div>
        ) : null}

        {showDuration ? (
          <div>
            {COPY.consultRevisionNotice.durationLead}{' '}
            {COPY.consultRevisionNotice.bookedLabel}{' '}
            {minutesLabel(notice.committedDurationMinutes)},{' '}
            {COPY.consultRevisionNotice.nowLabel}{' '}
            {minutesLabel(notice.finalDurationMinutes)}.
          </div>
        ) : null}
      </div>

      <div className="mt-2 text-[13px] font-medium text-textSecondary">
        {COPY.consultRevisionNotice.body}
      </div>

    </div>
  )
}
