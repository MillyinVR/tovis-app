// app/client/bookings/[id]/MediaConsentCard.tsx
'use client'

// The client's "Photos & sharing" consent toggle on the aftercare detail (B3b).
// Granting lets the pro feature THIS session's before/after publicly (portfolio /
// Looks) — it only UNLOCKS the pro's publish action (see lib/media/publicShareGuard),
// it never auto-shares. Mirrors the iOS BookingDetailView consent card 1:1.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import ToggleSwitch from '@/app/_components/ToggleSwitch'
import { COPY } from '@/lib/copy'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'

type Props = {
  bookingId: string
  /** Whether consent is currently granted (from ClientBookingDTO.mediaUseConsent). */
  granted: boolean
}

export default function MediaConsentCard({ bookingId, granted }: Props) {
  const router = useRouter()
  const [on, setOn] = useState(granted)
  const [working, setWorking] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function setConsent(next: boolean) {
    if (working) return
    setErr(null)
    setWorking(true)
    setOn(next) // optimistic

    try {
      const res = await fetch(
        `/api/v1/client/bookings/${encodeURIComponent(bookingId)}/media-consent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ granted: next }),
        },
      )

      const data = await safeJson(res)
      if (!res.ok) {
        const message =
          isRecord(data) && typeof data.error === 'string' && data.error.trim()
            ? data.error.trim()
            : COPY.bookings.aftercare.mediaConsentError
        throw new Error(message)
      }

      // Trust the server's confirmed state, then refresh so the DTO reflects it.
      const confirmed =
        isRecord(data) && typeof data.mediaUseConsent === 'boolean'
          ? data.mediaUseConsent
          : next
      setOn(confirmed)
      router.refresh()
    } catch (error: unknown) {
      setOn(!next) // revert
      setErr(
        error instanceof Error
          ? error.message
          : COPY.bookings.aftercare.mediaConsentError,
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="brand-pro-session-card">
      <div className="brand-pro-session-section-row">
        <div>
          <div className="brand-pro-session-section-title">
            {COPY.bookings.aftercare.mediaConsentTitle}
          </div>
          <div className="brand-pro-session-card-body mt-1">
            {COPY.bookings.aftercare.mediaConsentDescription}
          </div>
        </div>

        <ToggleSwitch
          checked={on}
          onChange={setConsent}
          disabled={working}
          label={COPY.bookings.aftercare.mediaConsentLabel}
        />
      </div>

      {err ? (
        <div className="mt-3 text-sm font-semibold text-microAccent">{err}</div>
      ) : null}
    </section>
  )
}
