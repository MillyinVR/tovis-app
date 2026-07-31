// app/client/bookings/[id]/ClientConfirmationCard.tsx
'use client'

// K13: the in-app half of K12's confirmation loop. A client who is already
// signed in answers "can you make it?" here instead of digging the reminder SMS
// back out of their messages.
//
// Deliberately answer-ONLY. Cancel and reschedule already live on this page
// (ClientBookingActionsCard, through the hold path and the policy snapshot) —
// the token page has to carry its own copies because nothing else on it can,
// and duplicating them here would put two cancel buttons with two code paths on
// one screen.
//
// The card renders only while the pro has actually asked (the DTO omits
// `clientConfirmation` unless the badge is significant), so with the loop flag
// off this page is byte-identical to pre-K13.

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'

type Answer = 'CONFIRM' | 'DECLINE'

type Props = {
  bookingId: string
  /** K11's derived state — 'AWAITING_CLIENT' | 'CLIENT_CONFIRMED' | 'DECLINED'. */
  state: string
  /** The pro's display name, for the confirmed/declined sentences. */
  professionalLabel: string
  /** Already-formatted appointment time ("Fri, Aug 21 at 2:00 PM"). */
  whenLabel: string
}

const PRIMARY_BUTTON =
  'brand-button-primary brand-focus inline-flex items-center justify-center gap-1 rounded-full px-4 py-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-60'

const SECONDARY_BUTTON =
  'brand-focus inline-flex items-center justify-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass/10 disabled:cursor-not-allowed disabled:opacity-60'

function errorFrom(data: unknown): string {
  if (isRecord(data)) {
    const message =
      typeof data.userMessage === 'string' && data.userMessage.trim()
        ? data.userMessage.trim()
        : typeof data.error === 'string' && data.error.trim()
          ? data.error.trim()
          : null
    if (message) return message
  }
  return 'Something went wrong. Please try again.'
}

export default function ClientConfirmationCard(props: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<Answer | null>(null)
  const [error, setError] = useState<string | null>(null)

  const confirmed = props.state === 'CLIENT_CONFIRMED'
  const declined = props.state === 'DECLINED'

  async function answer(value: Answer) {
    if (busy) return
    setError(null)
    setBusy(value)

    try {
      const res = await fetch(
        `/api/v1/client/bookings/${encodeURIComponent(props.bookingId)}/confirmation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer: value }),
        },
      )

      const data = await safeJson(res)
      if (!res.ok) throw new Error(errorFrom(data))

      // The state lives on the server row — re-read it rather than guessing
      // locally, so a refusal the route made (already started, cancelled) can
      // never leave this card claiming an answer the booking doesn't carry.
      router.refresh()
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong. Please try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-3 rounded-card border border-white/10 bg-bgSecondary p-4">
      {confirmed ? (
        <div className="rounded-card border border-toneSuccess/20 bg-toneSuccess/5 px-4 py-3">
          <div className="text-sm font-black text-textPrimary">
            You’re confirmed — see you {props.whenLabel}
          </div>
          <div className="mt-1 text-sm text-textSecondary">
            {props.professionalLabel} can see you’re coming.
          </div>
        </div>
      ) : declined ? (
        <div className="rounded-card border border-toneWarn/30 bg-toneWarn/10 px-4 py-3">
          <div className="text-sm font-black text-textPrimary">
            We’ve let {props.professionalLabel} know you can’t make it
          </div>
          <div className="mt-1 text-sm text-textSecondary">
            The appointment stays on the calendar until they update it — you can
            also cancel or move it below.
          </div>
        </div>
      ) : (
        <>
          <div className="text-sm font-black text-textPrimary">
            Can you make it?
          </div>
          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
            {props.whenLabel}
          </div>
        </>
      )}

      {error ? (
        <div className="mt-3 rounded-card border border-toneDanger/30 bg-toneDanger/10 px-4 py-3 text-sm text-textPrimary">
          {error}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {confirmed ? null : (
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={busy != null}
            onClick={() => void answer('CONFIRM')}
          >
            {busy === 'CONFIRM' ? 'Confirming…' : 'Yes, I’ll be there'}
          </button>
        )}

        {declined ? null : (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={busy != null}
            onClick={() => void answer('DECLINE')}
          >
            {busy === 'DECLINE'
              ? 'One moment…'
              : confirmed
                ? 'Actually, I can’t make it'
                : 'I can’t make it'}
          </button>
        )}
      </div>
    </div>
  )
}
