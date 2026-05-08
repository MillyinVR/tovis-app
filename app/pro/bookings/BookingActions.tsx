// app/pro/bookings/BookingActions.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookingStatus, SessionStep } from '@prisma/client'
import { pickTimeZoneOrNull } from '@/lib/timeZone'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { safeJson } from '@/lib/http'
import {
  buildLifecycleActionViewModel,
  type LifecycleAction,
} from '@/lib/booking/lifecycleActionViewModel'

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
}

type JsonObject = Record<string, unknown>

function isRecord(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
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

function errorFromResponse(res: Response, data: unknown) {
  const root = isRecord(data) ? data : null
  const error = root ? readString(root.error) : null
  if (error) return error

  const message = root ? readString(root.message) : null
  if (message) return message

  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You do not have access to do that.'
  if (res.status === 404) return 'Not found.'
  if (res.status === 409) return 'That action is not allowed right now.'
  return `Request failed (${res.status}).`
}

function buildIdempotencyKey(hint: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${hint}:${crypto.randomUUID()}`
  }
  return `${hint}:${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function BookingActions({
  bookingId,
  status,
  sessionStep,
  startedAt,
  finishedAt,
  timeZone,
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
      }),
    [bookingId, status, sessionStep, startedAt, finishedAt],
  )

  const started = useMemo(() => Boolean(parseIso(startedAt)), [startedAt])
  const startedLabel = formatWhen(startedAt, timeZone)
  const finishedLabel = formatWhen(finishedAt, timeZone)

  async function run(action: LifecycleAction) {
    if (pendingVerb) return

    if (action.confirmCopy) {
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

    const idempotencyKey = buildIdempotencyKey(action.idempotencyKeyHint)

    try {
      const init: RequestInit = {
        method: action.method,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'x-idempotency-key': idempotencyKey,
        },
        signal: controller.signal,
      }

      if (action.payload) {
        init.body = JSON.stringify(action.payload)
      }

      const res = await fetch(action.href, init)
      const data: unknown = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data))
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
    'disabled:cursor-not-allowed disabled:opacity-60 border border-white/10'

  const btnPrimary = `${btnBase} bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover`
  const btnGhost = `${btnBase} bg-bgPrimary text-textPrimary hover:border-white/20`

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
