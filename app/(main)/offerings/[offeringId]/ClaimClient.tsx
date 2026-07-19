// app/(main)/offerings/[offeringId]/ClaimClient.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { buildClientIdempotencyKey, idempotencyHeaders } from '@/lib/idempotency/client'
import { isRecord } from '@/lib/guards'
import { isOpeningGoneCode } from '@/lib/booking/errors'

type Props = {
  offeringId: string
  openingId: string
  scheduledFor: string
  locationType: 'SALON' | 'MOBILE'
  locationId: string
  defaultAddressId: string | null
  isAuthed: boolean
  loginHref: string
}

function readBookingId(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  const booking = raw.booking
  if (isRecord(booking) && typeof booking.id === 'string') return booking.id
  return null
}

function readError(raw: unknown, fallback: string): string {
  if (isRecord(raw)) {
    // `error` is the USER-facing copy every booking error carries; `message` is
    // the internal one ("Requested opening is no longer available."). Prefer the
    // one written for a human.
    if (typeof raw.error === 'string' && raw.error.trim()) return raw.error
    if (typeof raw.message === 'string' && raw.message.trim()) return raw.message
  }
  return fallback
}

/**
 * How a failed hold/finalize should be reported.
 *
 * A 409 is NOT automatically a lost race: `PRO_NOT_READY` and the
 * location-config family answer 409 too, and both are reachable here when a pro's
 * setup drifts after the opening was published. Branching on the status alone
 * told those clients "Someone just grabbed it" about a slot that was still
 * available. Branch on the CODE, and fall back to the server's own user-facing
 * copy — the same rule the iOS claim sheet applies (`OpeningClaimFailure`).
 */
function classifyClaimFailure(
  status: number,
  raw: unknown,
): { taken: true } | { taken: false; message: string } {
  const code = isRecord(raw) ? raw.code : null

  if (isOpeningGoneCode(code)) return { taken: true }

  return {
    taken: false,
    message: readError(
      raw,
      status === 409
        ? 'That time is no longer available. Please try another opening.'
        : 'Could not complete the booking. Please try again.',
    ),
  }
}

export default function ClaimClient(props: Props) {
  const router = useRouter()
  const [claiming, setClaiming] = useState(false)
  const [taken, setTaken] = useState(false)
  const [needsAddress, setNeedsAddress] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function claim(): Promise<void> {
    if (claiming) return

    if (!props.isAuthed) {
      window.location.href = props.loginHref
      return
    }

    if (props.locationType === 'MOBILE' && !props.defaultAddressId) {
      setNeedsAddress(true)
      return
    }

    setClaiming(true)
    setError(null)

    try {
      // 1) Hold the fixed opening slot.
      const holdRes = await fetch('/api/v1/holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringId: props.offeringId,
          scheduledFor: props.scheduledFor,
          locationType: props.locationType,
          ...(props.locationType === 'SALON'
            ? { locationId: props.locationId }
            : { clientAddressId: props.defaultAddressId }),
        }),
      })
      const holdRaw: unknown = await holdRes.json().catch(() => null)

      if (holdRes.status === 401) {
        window.location.href = props.loginHref
        return
      }
      const hold = isRecord(holdRaw) ? holdRaw.hold : null
      const holdId = isRecord(hold) && typeof hold.id === 'string' ? hold.id : null
      if (!holdRes.ok || !holdId) {
        const outcome = classifyClaimFailure(holdRes.status, holdRaw)
        if (outcome.taken) setTaken(true)
        else setError(outcome.message)
        return
      }

      // 2) Finalize with openingId so the booking consumes the opening + applies its incentive.
      const idem = buildClientIdempotencyKey({
        scope: 'booking-finalize',
        entityId: holdId,
        action: 'complete',
      })
      const finRes = await fetch('/api/v1/bookings/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...idempotencyHeaders(idem) },
        body: JSON.stringify({
          holdId,
          offeringId: props.offeringId,
          locationType: props.locationType,
          source: 'REQUESTED',
          addOnIds: [],
          openingId: props.openingId,
        }),
      })
      const finRaw: unknown = await finRes.json().catch(() => null)

      if (finRes.status === 401) {
        window.location.href = props.loginHref
        return
      }
      const bookingId = readBookingId(finRaw)
      if (!finRes.ok || !bookingId) {
        const outcome = classifyClaimFailure(finRes.status, finRaw)
        if (outcome.taken) setTaken(true)
        else setError(outcome.message)
        return
      }

      router.push(`/booking/${encodeURIComponent(bookingId)}`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setClaiming(false)
    }
  }

  if (taken) {
    return (
      <div className="rounded-card border border-textPrimary/10 bg-bgSurface p-5 text-center">
        <div className="font-display text-[17px] font-bold text-textPrimary">
          Someone just grabbed it
        </div>
        <p className="mt-1.5 text-[13px] text-textMuted">
          This opening was claimed by someone else. There may be others available.
        </p>
        <a
          href="/client"
          className="mt-4 inline-flex rounded-full bg-accentPrimary px-5 py-2.5 font-display text-[13px] font-bold text-onAccent transition hover:bg-accentPrimaryHover"
        >
          See more openings
        </a>
      </div>
    )
  }

  return (
    <div>
      {needsAddress ? (
        <div className="mb-3 rounded-[14px] border border-amber/30 bg-bgSurface px-4 py-3 text-[12.5px] text-textSecondary">
          Add a service address to claim a mobile opening.{' '}
          <a href="/client/settings" className="font-semibold text-accentPrimary">
            Add an address →
          </a>
        </div>
      ) : null}

      {error ? (
        <div className="mb-3 rounded-[14px] border border-ember/30 bg-bgSurface px-4 py-3 text-[12.5px] text-textSecondary">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void claim()}
        disabled={claiming}
        className="flex h-[52px] w-full items-center justify-center rounded-[16px] bg-[image:var(--cta)] font-display text-[15px] font-bold text-onCta shadow-[0_8px_24px_rgb(var(--accent-primary)/0.28)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {claiming
          ? 'Claiming…'
          : props.isAuthed
            ? 'Claim this opening →'
            : 'Log in to claim →'}
      </button>

      <p className="mt-2.5 text-center font-mono text-[10px] uppercase tracking-[0.08em] text-textMuted">
        Pay at your booking · first to claim gets it
      </p>
    </div>
  )
}
