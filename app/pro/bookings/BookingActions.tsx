// app/pro/bookings/BookingActions.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookingStatus, SessionStep } from '@/lib/prismaEnums'
import { pickTimeZoneOrNull } from '@/lib/timeZone'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { errorFromResponse, safeJson } from '@/lib/http'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'
import {
  buildLifecycleActionViewModel,
  type LifecycleAction,
} from '@/lib/booking/lifecycleActionViewModel'

const STATUS_COPY = {
  401: 'Please log in to continue.',
  403: 'You do not have access to do that.',
  404: 'Not found.',
  409: 'That action is not allowed right now.',
}

type Props = {
  bookingId: string
  status: BookingStatus
  sessionStep?: SessionStep | null
  startedAt?: string | null
  finishedAt?: string | null

  /**
   * Appointment timezone (preferred: booking.locationTimeZone).
   * UI policy: do NOT invent a timezone if missing.
   */
  timeZone?: string | null

  /**
   * Phase 2 revenue protection flag (server-side `noShowProtectionEnabled()`).
   * Gates the "Mark no-show" action so it stays hidden while the `/no-show`
   * route is dark (404).
   */
  noShowFeatureEnabled?: boolean
}

function parseIso(iso?: string | null): Date | null {
  if (!iso || typeof iso !== 'string') return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatWhen(iso: string | null | undefined, timeZone?: string | null) {
  const d = parseIso(iso)
  if (!d) return null

  const tz = pickTimeZoneOrNull(timeZone)
  if (!tz) return null

  return formatAppointmentWhen(d, tz)
}

export default function BookingActions({
  bookingId,
  status,
  sessionStep,
  startedAt,
  finishedAt,
  timeZone,
  noShowFeatureEnabled,
}: Props) {
  const router = useRouter()

  const [pendingVerb, setPendingVerb] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const viewModel = useMemo(
    () =>
      buildLifecycleActionViewModel({
        bookingId,
        status,
        sessionStep: sessionStep ?? null,
        role: 'PRO',
        startedAt: startedAt ?? null,
        finishedAt: finishedAt ?? null,
        noShowFeatureEnabled,
      }),
    [bookingId, status, sessionStep, startedAt, finishedAt, noShowFeatureEnabled],
  )

  const started = useMemo(() => Boolean(parseIso(startedAt)), [startedAt])
  const startedLabel = formatWhen(startedAt, timeZone)
  const finishedLabel = formatWhen(finishedAt, timeZone)

  async function run(action: LifecycleAction) {
    if (pendingVerb) return

    if (action.confirmCopy && typeof window !== 'undefined') {
      const ok = window.confirm(action.confirmCopy)
      if (!ok) return
    }

    if (action.method === 'NAVIGATE') {
      if (action.href) router.push(action.href)
      return
    }

    if (!action.href) {
      setError('Action is missing a destination.')
      return
    }

    setError(null)
    setPendingVerb(action.verb)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      // Deterministic per (booking, verb): a double-click replays the first
      // response instead of re-running the lifecycle transition. Built inside
      // the try — it throws on an empty bookingId, and the catch/finally must
      // surface that rather than leave the buttons stuck disabled.
      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'booking-lifecycle',
        entityId: bookingId,
        action: action.verb,
      })

      const init: RequestInit = {
        method: action.method,
        headers: {
          'Content-Type': 'application/json',
          ...idempotencyHeaders(idempotencyKey),
        },
        signal: controller.signal,
      }

      if (action.payload) {
        init.body = JSON.stringify(action.payload)
      }

      const res = await fetch(action.href, init)
      const data: unknown = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data, { byStatus: STATUS_COPY }))
        return
      }

      router.refresh()
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error(err)
      setError(
        err instanceof Error
          ? err.message
          : 'Network error while updating booking.',
      )
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setPendingVerb(null)
      }
    }
  }

  const btnBase =
    'inline-flex items-center justify-center rounded-full px-3 py-2 text-[12px] font-black transition ' +
    'disabled:cursor-not-allowed disabled:opacity-60 border border-surfaceGlass/10'

  const btnPrimary = `${btnBase} bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover`
  const btnGhost = `${btnBase} bg-bgPrimary text-textPrimary hover:border-surfaceGlass/20`

  if (viewModel.isTerminal || viewModel.actions.length === 0) {
    return (
      <div className="text-[12px] text-textSecondary">
        Status:{' '}
        <span className="font-black text-textPrimary">
          {viewModel.displayLabel}
        </span>
        {finishedLabel ? (
          <span className="ml-2 text-textSecondary">• {finishedLabel}</span>
        ) : null}
      </div>
    )
  }

  return (
    <div className="grid gap-2 justify-items-start md:justify-items-end">
      <div className="text-[12px] text-textSecondary">
        Status:{' '}
        <span className="font-black text-textPrimary">
          {viewModel.displayLabel}
        </span>
        {started ? (
          <span className="ml-2 text-textSecondary">
            • Started{startedLabel ? ` ${startedLabel}` : ''}
          </span>
        ) : null}
      </div>

      {error ? (
        <div
          aria-live="polite"
          className="max-w-65 text-right text-[11px] font-black text-microAccent"
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-start gap-2 md:justify-end">
        {viewModel.actions.map((action) => (
          <button
            key={action.verb}
            type="button"
            onClick={() => run(action)}
            disabled={pendingVerb !== null}
            className={action.primary ? btnPrimary : btnGhost}
          >
            {pendingVerb === action.verb
              ? `${action.label}…`
              : action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
