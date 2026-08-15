'use client'

// K12: the interactive half of the public appointment action page.
//
// Confirm and decline are ONE-TAP (idempotent on the server — a double tap or
// a change of mind just re-stamps; K11's latest-answer-wins derivation was
// designed for this). Cancel and reschedule NEVER fire from a single tap:
// each opens an explicit confirmation view first, because anyone holding the
// SMS holds the token and those two actions move money/time.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ServiceLocationType } from '@prisma/client'

import type { ClientConfirmationState } from '@/lib/booking/clientConfirmation'
import { isRecord } from '@/lib/guards'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'
import { formatInTimeZone } from '@/lib/time'
import { readErrorMessageOr } from '@/lib/http'

type RescheduleContext = {
  professionalId: string
  serviceId: string
  locationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  timeZone: string
  appointmentYmd: string
}

type Props = {
  token: string
  initialState: ClientConfirmationState
  whenLabel: string
  tzLabel: string
  professionalLabel: string
  fullRefundEligible: boolean
  depositPaid: boolean
  depositAmountLabel: string | null
  /** Null when the booking can't drive the public slot picker (no service/location row). */
  reschedule: RescheduleContext | null
}

type View =
  | { kind: 'main' }
  | { kind: 'cancelConfirm' }
  | { kind: 'cancelled'; message: string }
  | { kind: 'reschedule' }
  | {
      kind: 'rescheduleConfirm'
      holdId: string
      slotIso: string
      expiresAt: string
    }
  | { kind: 'rescheduled'; slotIso: string }

type SlotsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; slots: string[] }
  | { kind: 'error'; message: string }

async function postJson(args: {
  url: string
  body: unknown
  idempotencyKey?: string
}): Promise<{ ok: boolean; payload: unknown }> {
  const res = await fetch(args.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(args.idempotencyKey ? idempotencyHeaders(args.idempotencyKey) : {}),
    },
    body: JSON.stringify(args.body),
  })
  const payload: unknown = await res.json().catch(() => null)
  return { ok: res.ok, payload }
}

const PRIMARY_BUTTON =
  'inline-flex w-full items-center justify-center rounded-card bg-accentPrimary px-4 py-3 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON =
  'inline-flex w-full items-center justify-center rounded-card border border-textPrimary/10 bg-bgPrimary px-4 py-3 text-sm font-black text-textPrimary disabled:opacity-60'
const DANGER_BUTTON =
  'inline-flex w-full items-center justify-center rounded-card border border-toneDanger/30 bg-toneDanger/10 px-4 py-3 text-sm font-black text-textPrimary disabled:opacity-60'

export function AppointmentActionsCard(props: Props) {
  const [answerState, setAnswerState] = useState<ClientConfirmationState>(
    props.initialState,
  )
  const [view, setView] = useState<View>({ kind: 'main' })
  const [busy, setBusy] = useState<
    'confirm' | 'decline' | 'cancel' | 'hold' | 'reschedule' | null
  >(null)
  const [error, setError] = useState<string | null>(null)

  const [date, setDate] = useState<string>(
    props.reschedule?.appointmentYmd ?? '',
  )
  const [slotsState, setSlotsState] = useState<SlotsState>({ kind: 'idle' })

  const answer = useCallback(
    async (value: 'CONFIRM' | 'DECLINE') => {
      if (busy) return
      setBusy(value === 'CONFIRM' ? 'confirm' : 'decline')
      setError(null)

      const { ok, payload } = await postJson({
        url: `/api/v1/public/appointment/${encodeURIComponent(props.token)}/answer`,
        body: { answer: value },
      }).catch(() => ({ ok: false, payload: null }))

      setBusy(null)

      if (!ok) {
        setError(
          readErrorMessageOr(payload, 'Something went wrong. Please try again.'),
        )
        return
      }

      setAnswerState(value === 'CONFIRM' ? 'CLIENT_CONFIRMED' : 'DECLINED')
    },
    [busy, props.token],
  )

  const cancelAppointment = useCallback(async () => {
    if (busy) return
    setBusy('cancel')
    setError(null)

    // Deterministic per token+booking: a double-tap replays the first cancel
    // instead of re-entering the refund legs.
    const idempotencyKey = buildClientIdempotencyKey({
      scope: 'public-appointment',
      entityId: props.token,
      action: 'cancel',
    })

    const { ok, payload } = await postJson({
      url: `/api/v1/public/appointment/${encodeURIComponent(props.token)}/cancel`,
      body: {},
      idempotencyKey,
    }).catch(() => ({ ok: false, payload: null }))

    setBusy(null)

    if (!ok) {
      setError(
        readErrorMessageOr(payload, 'Could not cancel. Please try again.'),
      )
      return
    }

    const refundMessage =
      isRecord(payload) &&
      isRecord(payload.refund) &&
      typeof payload.refund.message === 'string'
        ? payload.refund.message
        : 'Your appointment was cancelled.'

    setView({ kind: 'cancelled', message: refundMessage })
  }, [busy, props.token])

  const loadSlots = useCallback(
    async (ymd: string) => {
      const ctx = props.reschedule
      if (!ctx) return
      setSlotsState({ kind: 'loading' })

      const params = new URLSearchParams({
        professionalId: ctx.professionalId,
        serviceId: ctx.serviceId,
        locationType: ctx.locationType,
        locationId: ctx.locationId,
        date: ymd,
      })
      if (ctx.clientAddressId) {
        params.set('clientAddressId', ctx.clientAddressId)
      }

      try {
        const res = await fetch(`/api/v1/availability/day?${params.toString()}`, {
          cache: 'no-store',
        })
        const payload: unknown = await res.json().catch(() => null)

        if (!res.ok) {
          setSlotsState({
            kind: 'error',
            message: readErrorMessageOr(
              payload,
              'Could not load available times for this day.',
            ),
          })
          return
        }

        const slots =
          isRecord(payload) && Array.isArray(payload.slots)
            ? payload.slots.filter(
                (slot): slot is string => typeof slot === 'string',
              )
            : []

        setSlotsState({ kind: 'loaded', slots })
      } catch {
        setSlotsState({
          kind: 'error',
          message: 'Could not load available times for this day.',
        })
      }
    },
    [props.reschedule],
  )

  useEffect(() => {
    if (view.kind === 'reschedule' && date) {
      void loadSlots(date)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind, date])

  const holdSlot = useCallback(
    async (slotIso: string) => {
      if (busy) return
      setBusy('hold')
      setError(null)

      const { ok, payload } = await postJson({
        url: `/api/v1/public/appointment/${encodeURIComponent(props.token)}/reschedule-hold`,
        body: { scheduledFor: slotIso },
      }).catch(() => ({ ok: false, payload: null }))

      setBusy(null)

      if (!ok) {
        setError(
          readErrorMessageOr(
            payload,
            'That time isn’t available anymore. Please pick another.',
          ),
        )
        return
      }

      const hold = isRecord(payload) ? payload.hold : null
      const holdId =
        isRecord(hold) && typeof hold.id === 'string' ? hold.id : null
      const expiresAt =
        isRecord(hold) && typeof hold.expiresAt === 'string'
          ? hold.expiresAt
          : ''

      if (!holdId) {
        setError('That time isn’t available anymore. Please pick another.')
        return
      }

      setView({ kind: 'rescheduleConfirm', holdId, slotIso, expiresAt })
    },
    [busy, props.token],
  )

  const commitReschedule = useCallback(
    async (holdId: string, slotIso: string) => {
      if (busy) return
      setBusy('reschedule')
      setError(null)

      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'public-appointment',
        entityId: props.token,
        action: 'reschedule',
        nonce: holdId,
      })

      const { ok, payload } = await postJson({
        url: `/api/v1/public/appointment/${encodeURIComponent(props.token)}/reschedule`,
        body: { holdId },
        idempotencyKey,
      }).catch(() => ({ ok: false, payload: null }))

      setBusy(null)

      if (!ok) {
        setError(
          readErrorMessageOr(
            payload,
            'Could not move the appointment. Please pick another time.',
          ),
        )
        setView({ kind: 'reschedule' })
        return
      }

      setView({ kind: 'rescheduled', slotIso })
    },
    [busy, props.token],
  )

  const formatSlot = useCallback(
    (iso: string) => {
      const tz = props.reschedule?.timeZone ?? 'UTC'
      return formatInTimeZone(new Date(iso), tz, {
        hour: 'numeric',
        minute: '2-digit',
      })
    },
    [props.reschedule],
  )

  const formatSlotFull = useCallback(
    (iso: string) => {
      const tz = props.reschedule?.timeZone ?? 'UTC'
      return formatInTimeZone(new Date(iso), tz, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    },
    [props.reschedule],
  )

  const cancelConsequence = useMemo(() => {
    if (props.depositPaid && props.depositAmountLabel) {
      return props.fullRefundEligible
        ? `You're more than 24 hours out, so your ${props.depositAmountLabel} deposit will be refunded.`
        : `This is within 24 hours of the appointment, so your ${props.depositAmountLabel} deposit won't be refunded.`
    }

    return props.fullRefundEligible
      ? 'You’re more than 24 hours out — anything already paid will be refunded.'
      : 'This is within 24 hours of the appointment, so a late-cancellation charge may apply.'
  }, [props.depositPaid, props.depositAmountLabel, props.fullRefundEligible])

  if (view.kind === 'cancelled') {
    return (
      <div className="rounded-card border border-toneDanger/20 bg-toneDanger/5 p-5">
        <div className="text-sm font-black text-textPrimary">
          Your appointment was cancelled
        </div>
        <div className="mt-2 text-sm text-textSecondary">{view.message}</div>
        <div className="mt-2 text-sm text-textSecondary">
          We’ve let {props.professionalLabel} know.
        </div>
      </div>
    )
  }

  if (view.kind === 'rescheduled') {
    return (
      <div className="rounded-card border border-toneSuccess/20 bg-toneSuccess/5 p-5">
        <div className="text-sm font-black text-textPrimary">
          Appointment moved — see you {formatSlotFull(view.slotIso)}
        </div>
        <div className="mt-2 text-sm text-textSecondary">
          {props.professionalLabel} has been notified of the new time. You’ll
          get a fresh reminder before the appointment.
        </div>
      </div>
    )
  }

  if (view.kind === 'cancelConfirm') {
    return (
      <div className="rounded-card border border-textPrimary/10 bg-bgSecondary p-5">
        <div className="text-sm font-black text-textPrimary">
          Cancel this appointment?
        </div>
        <div className="mt-2 text-sm text-textSecondary">
          {cancelConsequence}
        </div>

        {error ? (
          <div className="mt-3 rounded-card border border-toneDanger/30 bg-toneDanger/10 px-4 py-3 text-sm text-textPrimary">
            {error}
          </div>
        ) : null}

        <div className="mt-4 grid gap-2">
          <button
            type="button"
            className={DANGER_BUTTON}
            disabled={busy != null}
            onClick={() => void cancelAppointment()}
          >
            {busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel it'}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={busy != null}
            onClick={() => {
              setError(null)
              setView({ kind: 'main' })
            }}
          >
            Keep my appointment
          </button>
        </div>
      </div>
    )
  }

  if (view.kind === 'rescheduleConfirm') {
    return (
      <div className="rounded-card border border-textPrimary/10 bg-bgSecondary p-5">
        <div className="text-sm font-black text-textPrimary">
          Move your appointment to {formatSlotFull(view.slotIso)}?
        </div>
        <div className="mt-2 text-sm text-textSecondary">
          The time is held for you for a few minutes while you decide.
        </div>

        {error ? (
          <div className="mt-3 rounded-card border border-toneDanger/30 bg-toneDanger/10 px-4 py-3 text-sm text-textPrimary">
            {error}
          </div>
        ) : null}

        <div className="mt-4 grid gap-2">
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={busy != null}
            onClick={() => void commitReschedule(view.holdId, view.slotIso)}
          >
            {busy === 'reschedule' ? 'Moving…' : 'Confirm new time'}
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={busy != null}
            onClick={() => {
              setError(null)
              setView({ kind: 'reschedule' })
            }}
          >
            Pick a different time
          </button>
        </div>
      </div>
    )
  }

  if (view.kind === 'reschedule') {
    const ctx = props.reschedule
    return (
      <div className="rounded-card border border-textPrimary/10 bg-bgSecondary p-5">
        <div className="text-sm font-black text-textPrimary">
          Pick a new time
        </div>
        <div className="mt-2 text-sm text-textSecondary">
          Same place, same service — just a new time
          {ctx ? <> ({props.tzLabel})</> : null}.
        </div>

        <label className="mt-4 block text-xs font-black text-textSecondary">
          Day
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="mt-1 w-full rounded-card border border-textPrimary/10 bg-bgPrimary px-3 py-2 text-sm text-textPrimary"
          />
        </label>

        <div className="mt-4">
          {slotsState.kind === 'loading' ? (
            <div className="text-sm text-textSecondary">Loading times…</div>
          ) : slotsState.kind === 'error' ? (
            <div className="text-sm text-textSecondary">
              {slotsState.message}
            </div>
          ) : slotsState.kind === 'loaded' && slotsState.slots.length === 0 ? (
            <div className="text-sm text-textSecondary">
              No open times that day — try another.
            </div>
          ) : slotsState.kind === 'loaded' ? (
            <div className="grid grid-cols-3 gap-2">
              {slotsState.slots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  className="rounded-card border border-textPrimary/10 bg-bgPrimary px-2 py-2 text-sm font-black text-textPrimary disabled:opacity-60"
                  disabled={busy != null}
                  onClick={() => void holdSlot(slot)}
                >
                  {formatSlot(slot)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="mt-3 rounded-card border border-toneDanger/30 bg-toneDanger/10 px-4 py-3 text-sm text-textPrimary">
            {error}
          </div>
        ) : null}

        <div className="mt-4">
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={busy != null}
            onClick={() => {
              setError(null)
              setView({ kind: 'main' })
            }}
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  // Main view.
  const confirmed = answerState === 'CLIENT_CONFIRMED'
  const declined = answerState === 'DECLINED'

  return (
    <div className="rounded-card border border-textPrimary/10 bg-bgSecondary p-5">
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
            The appointment stays on the calendar until they update it — you
            can also cancel or move it below.
          </div>
        </div>
      ) : (
        <div className="text-sm font-black text-textPrimary">
          Can you make it?
        </div>
      )}

      {error ? (
        <div className="mt-3 rounded-card border border-toneDanger/30 bg-toneDanger/10 px-4 py-3 text-sm text-textPrimary">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid gap-2">
        {confirmed ? null : (
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={busy != null}
            onClick={() => void answer('CONFIRM')}
          >
            {busy === 'confirm' ? 'Confirming…' : 'Yes, I’ll be there'}
          </button>
        )}

        {declined ? null : (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={busy != null}
            onClick={() => void answer('DECLINE')}
          >
            {busy === 'decline'
              ? 'One moment…'
              : confirmed
                ? 'Actually, I can’t make it'
                : 'I can’t make it'}
          </button>
        )}

        {props.reschedule ? (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={busy != null}
            onClick={() => {
              setError(null)
              setView({ kind: 'reschedule' })
            }}
          >
            Reschedule
          </button>
        ) : null}

        <button
          type="button"
          className={DANGER_BUTTON}
          disabled={busy != null}
          onClick={() => {
            setError(null)
            setView({ kind: 'cancelConfirm' })
          }}
        >
          Cancel appointment
        </button>
      </div>
    </div>
  )
}
