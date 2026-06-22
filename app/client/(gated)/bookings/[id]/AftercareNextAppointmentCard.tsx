// app/client/bookings/[id]/AftercareNextAppointmentCard.tsx
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import AftercareRebookButton from './AftercareRebookButton'
import { COPY } from '@/lib/copy'
import { friendlyTimeZoneLabel } from '@/lib/timeZone'
import { safeJson } from '@/lib/http'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'
import { isRecord } from '@/lib/guards'

type Props = {
  bookingId: string
  /** Pro's proposed next-appointment time (ISO). */
  scheduledForIso: string
  timeZone: string
  /** Drawer context for "schedule a different time". */
  professionalId: string
  serviceId: string | null
  /** If the client already confirmed, the resulting booking id (else null). */
  confirmedBookingId: string | null
  /** True once the client has declined this proposed time. */
  declined: boolean
}

type Action = 'CONFIRM' | 'DECLINE'

function formatWhen(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function errorFrom(res: Response, data: unknown): string {
  const error =
    isRecord(data) && typeof data.error === 'string' && data.error.trim()
      ? data.error.trim()
      : null
  if (error) return error
  if (res.status === 409) return COPY.bookings.aftercare.nextAppointmentUnavailable
  return COPY.bookings.aftercare.nextAppointmentError
}

export default function AftercareNextAppointmentCard({
  bookingId,
  scheduledForIso,
  timeZone,
  professionalId,
  serviceId,
  confirmedBookingId,
  declined,
}: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState<Action | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const whenLabel = formatWhen(scheduledForIso, timeZone)

  async function act(action: Action) {
    if (loading) return
    setErr(null)
    setLoading(action)

    try {
      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'client-aftercare-next-appointment',
        entityId: bookingId,
        action,
      })

      const res = await fetch(
        `/api/client/bookings/${encodeURIComponent(bookingId)}/aftercare-rebook`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...idempotencyHeaders(idempotencyKey),
          },
          body: JSON.stringify({ action }),
        },
      )

      const data = await safeJson(res)
      if (!res.ok) throw new Error(errorFrom(res, data))

      if (action === 'CONFIRM') {
        const newId =
          isRecord(data) && isRecord(data.booking) && typeof data.booking.id === 'string'
            ? data.booking.id
            : null
        router.refresh()
        if (newId) {
          router.push(`/client/bookings/${encodeURIComponent(newId)}`)
        }
      } else {
        router.refresh()
      }
    } catch (error: unknown) {
      setErr(
        error instanceof Error
          ? error.message
          : COPY.bookings.aftercare.nextAppointmentError,
      )
    } finally {
      setLoading(null)
    }
  }

  if (confirmedBookingId) {
    return (
      <div className="mt-3 rounded-card border border-toneSuccess/20 bg-toneSuccess/5 p-4">
        <div className="text-sm font-black text-textPrimary">
          {COPY.bookings.aftercare.nextAppointmentConfirmedLabel}
        </div>
        <div className="mt-1 text-sm text-textSecondary">
          {whenLabel} · {friendlyTimeZoneLabel(timeZone) ?? timeZone}
        </div>
        <Link
          href={`/client/bookings/${encodeURIComponent(confirmedBookingId)}`}
          className="mt-3 inline-flex items-center gap-1 rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
        >
          {COPY.bookings.aftercare.nextAppointmentConfirmedCta} <span aria-hidden>→</span>
        </Link>
      </div>
    )
  }

  if (declined) {
    return (
      <div className="mt-3 rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="text-sm font-black text-textPrimary">
          {COPY.bookings.aftercare.nextAppointmentDeclinedLabel}
        </div>
        <div className="mt-1 text-sm text-textSecondary">
          {whenLabel} · {friendlyTimeZoneLabel(timeZone) ?? timeZone}
        </div>

        <AftercareRebookButton
          professionalId={professionalId}
          serviceId={serviceId}
          anchorStartIso={scheduledForIso}
          timeZone={timeZone}
          label={COPY.bookings.aftercare.nextAppointmentScheduleDifferent}
        />
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="text-base font-black text-textPrimary">{whenLabel}</div>
      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
        {friendlyTimeZoneLabel(timeZone) ?? timeZone}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => act('CONFIRM')}
          disabled={loading !== null}
          className="brand-button-primary brand-focus inline-flex items-center gap-1 rounded-full px-4 py-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading === 'CONFIRM'
            ? COPY.bookings.aftercare.nextAppointmentConfirming
            : COPY.bookings.aftercare.nextAppointmentConfirm}
        </button>

        <button
          type="button"
          onClick={() => act('DECLINE')}
          disabled={loading !== null}
          className="brand-focus inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading === 'DECLINE'
            ? COPY.bookings.aftercare.nextAppointmentCancelling
            : COPY.bookings.aftercare.nextAppointmentCancel}
        </button>
      </div>

      <AftercareRebookButton
        professionalId={professionalId}
        serviceId={serviceId}
        anchorStartIso={scheduledForIso}
        timeZone={timeZone}
        label={COPY.bookings.aftercare.nextAppointmentScheduleDifferent}
      />

      {err ? (
        <div className="mt-3 text-sm font-semibold text-microAccent">{err}</div>
      ) : null}
    </div>
  )
}
