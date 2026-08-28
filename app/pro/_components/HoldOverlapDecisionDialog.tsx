// app/pro/_components/HoldOverlapDecisionDialog.tsx
'use client'

import { useEffect } from 'react'

import { useHoldCountdown } from '@/app/pro/_hooks/useHoldCountdown'
import {
  holdOverlapPromptCopy,
  type HeldSlotDecision,
  type HoldOverlapPromptIntent,
} from '@/lib/booking/holdOverlapPrompt'
import { formatAppointmentWhen } from '@/lib/time'
import { zClass } from '@/lib/zIndex'

// ─── Types ────────────────────────────────────────────────────────────────────

type HoldOverlapDecisionDialogProps = {
  /** The decision to answer, or null when there is nothing to ask. */
  decision: HeldSlotDecision | null
  intent: HoldOverlapPromptIntent
  /** The booking location's timezone — the slot is shown in the pro's day. */
  timeZone: string
  busy: boolean
  onProceed: () => void
  onWait: () => void
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function lockBodyScroll(open: boolean) {
  if (!open) return

  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  return () => {
    document.body.style.overflow = previousOverflow
  }
}

function closeOnEscape(args: {
  open: boolean
  busy: boolean
  onWait: () => void
}) {
  if (!args.open) return

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !args.busy) {
      args.onWait()
    }
  }

  window.addEventListener('keydown', onKeyDown)

  return () => window.removeEventListener('keydown', onKeyDown)
}

// ─── Exported component ───────────────────────────────────────────────────────

/**
 * "Someone is checking out for this time" — the choice a pro is given before
 * booking over a client's live reservation (B5 follow-up, Tori 2026-08-28).
 *
 * 🔴 THIS DIALOG RENDERS NO CLIENT IDENTITY, and cannot: its only input about
 * the held client is `decision.relationship`, a three-value enum. There is no
 * name, initial, avatar or contact detail to render because the server never
 * sends one — a client mid-checkout has not agreed to be identified to a pro
 * before they commit (B5), and new-or-returning is the single exception Tori
 * approved. Adding anything else here is a product decision.
 *
 * The countdown is the SAME one the client is watching and the pro's calendar
 * tile shows — `useHoldCountdown` over `lib/booking/holdCountdown` — so one
 * reservation cannot read three different ways. When it reaches zero the dialog
 * says so rather than vanishing: the pro is mid-decision, and a popup that
 * disappeared under their cursor would leave them wondering what they just
 * clicked.
 */
export function HoldOverlapDecisionDialog(
  props: HoldOverlapDecisionDialogProps,
) {
  const { decision, intent, timeZone, busy, onProceed, onWait } = props

  const open = decision !== null
  const countdown = useHoldCountdown(decision?.expiresAt ?? null)

  useEffect(() => lockBodyScroll(open), [open])
  useEffect(
    () => closeOnEscape({ open, busy, onWait }),
    [open, busy, onWait],
  )

  if (!decision) return null

  const copy = holdOverlapPromptCopy(decision.relationship, intent)
  const urgent = countdown.urgent

  function wait() {
    if (busy) return
    onWait()
  }

  return (
    <div
      className={`fixed inset-0 ${zClass.modal} flex items-end justify-center bg-scrim/75 p-0 backdrop-blur-md sm:items-center sm:p-4`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hold-overlap-title"
      data-testid="hold-overlap-decision"
      onMouseDown={wait}
    >
      <div
        className={[
          'flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[24px]',
          'border border-surfaceGlass/15 bg-bgPrimary',
          'sm:max-w-[32rem] sm:rounded-[24px]',
        ].join(' ')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-surfaceGlass/10 px-5 py-4">
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-toneWarn">
            ◆ Checkout in progress
          </p>

          <h2
            id="hold-overlap-title"
            className="mt-1 font-display text-2xl font-semibold italic tracking-[-0.04em] text-textPrimary"
          >
            {copy.title}
          </h2>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {/*
            One sentence, in the order the pro reads it: WHO (new or returning
            to them), WHAT, WHEN. The relationship label is the only thing said
            about the person.
          */}
          <p
            className="text-base leading-7 text-textPrimary"
            data-testid="hold-overlap-summary"
          >
            {copy.leadIn}{' '}
            <span className="font-semibold">{decision.serviceName}</span> for{' '}
            <span className="font-semibold">
              {formatAppointmentWhen(decision.startsAt, timeZone)}
            </span>
            .
          </p>

          <div
            className={[
              'mt-4 flex items-baseline gap-2 rounded-2xl border px-4 py-3',
              urgent
                ? 'border-toneWarn/30 bg-toneWarn/10'
                : 'border-surfaceGlass/10 bg-surfaceGlass/5',
            ].join(' ')}
          >
            {countdown.expired ? (
              <p className="text-sm leading-6 text-textSecondary">
                {copy.countdownLapsedNote}
              </p>
            ) : (
              <>
                <span
                  className={[
                    'font-mono text-2xl font-black tabular-nums',
                    urgent ? 'text-toneWarn' : 'text-textPrimary',
                  ].join(' ')}
                  data-testid="hold-overlap-countdown"
                  // The number changes every second; announcing each tick would
                  // make a screen reader unusable. The label below carries the
                  // meaning, and the buttons do not move.
                  aria-live="off"
                >
                  {countdown.label}
                </span>
                <span className="font-mono text-[11px] font-black uppercase tracking-[0.1em] text-textSecondary">
                  {copy.countdownSuffix}
                </span>
              </>
            )}
          </div>

          {decision.additionalHeldSlots > 0 ? (
            <p className="mt-3 text-sm leading-6 text-textSecondary">
              {copy.additionalHeldSlotsNote(decision.additionalHeldSlots)}
            </p>
          ) : null}

          <p className="mt-4 text-[12px] leading-5 text-textSecondary">
            {copy.anonymityNote}
          </p>
        </div>

        <footer className="border-t border-surfaceGlass/10 px-5 py-4">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {/*
              "Wait" first in the DOM and the default on Escape / backdrop: the
              destructive choice here is taking the slot, and it should be the
              one the pro reaches for deliberately.
            */}
            <button
              type="button"
              onClick={wait}
              disabled={busy}
              className={[
                'rounded-full border border-surfaceGlass/15 px-4 py-2',
                'font-mono text-[11px] font-black uppercase tracking-[0.08em]',
                'text-textSecondary transition hover:text-textPrimary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
                'disabled:cursor-not-allowed disabled:opacity-60',
              ].join(' ')}
            >
              {copy.waitLabel}
            </button>

            <button
              type="button"
              onClick={onProceed}
              disabled={busy}
              className={[
                'rounded-full border border-accentPrimary/30 bg-accentPrimary px-4 py-2',
                'font-mono text-[11px] font-black uppercase tracking-[0.08em] text-onAccent',
                'transition hover:bg-accentPrimaryHover',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
                'disabled:cursor-not-allowed disabled:opacity-60',
              ].join(' ')}
            >
              {copy.proceedLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
