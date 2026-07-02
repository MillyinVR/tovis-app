'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { formatInTimeZone, getViewerTimeZone, DEFAULT_TIME_ZONE } from '@/lib/time'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'

type WaitlistOffer = {
  offerId: string
  status: string
  proName: string
  proHref: string | null
  avatarUrl: string | null
  serviceLabel: string
  startAt: string
  endAt: string | null
  timeZone: string
  locationType: string
  expiresAt: string | null
}

type Action = 'CONFIRM' | 'DECLINE'

function formatWhen(iso: string, timeZone: string): string {
  const tz = timeZone || getViewerTimeZone() || DEFAULT_TIME_ZONE
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return formatInTimeZone(date, tz, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function parseOffers(data: unknown): WaitlistOffer[] {
  if (!isRecord(data) || !Array.isArray(data.offers)) return []
  return data.offers.filter((offer): offer is WaitlistOffer => {
    return (
      isRecord(offer) &&
      typeof offer.offerId === 'string' &&
      typeof offer.serviceLabel === 'string' &&
      typeof offer.startAt === 'string'
    )
  })
}

/**
 * Client-facing Confirm/Decline cards for pro-proposed waitlist times. CONFIRM
 * books the appointment (ACCEPTED) and routes to it; DECLINE frees the pro to
 * offer another time. Renders nothing when there are no outstanding offers.
 */
export default function WaitlistOfferCards() {
  const router = useRouter()
  const [offers, setOffers] = useState<WaitlistOffer[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/client/waitlist-offers')
      const data = await safeJson(res)
      if (res.ok) setOffers(parseOffers(data))
    } catch {
      // Non-fatal: the priority-offers list below still renders.
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function act(offer: WaitlistOffer, action: Action) {
    if (busy) return
    setErr(null)
    setBusy(offer.offerId)

    try {
      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'client-waitlist-offer',
        entityId: offer.offerId,
        action,
      })

      const res = await fetch(
        `/api/v1/client/waitlist-offers/${encodeURIComponent(offer.offerId)}`,
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
      if (!res.ok) {
        const message =
          isRecord(data) && typeof data.error === 'string' && data.error.trim()
            ? data.error.trim()
            : action === 'CONFIRM'
              ? 'That time is no longer available.'
              : 'Could not decline this offer.'
        setErr(message)
        await load()
        return
      }

      if (action === 'CONFIRM') {
        const bookingId =
          isRecord(data) &&
          isRecord(data.booking) &&
          typeof data.booking.id === 'string'
            ? data.booking.id
            : null
        if (bookingId) {
          router.push(`/client/bookings/${encodeURIComponent(bookingId)}`)
          return
        }
      }

      await load()
    } catch {
      setErr('Something went wrong. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  if (!loaded || offers.length === 0) return null

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-textPrimary">
          Times offered to you
        </h2>
        <p className="text-sm text-textMuted">
          A pro you&rsquo;re waitlisted with proposed a specific appointment time.
          Confirm to book it, or decline to wait for another.
        </p>
      </header>

      {err ? (
        <div className="rounded-xl border border-toneDanger/30 bg-toneDanger/10 px-4 py-3 text-sm text-toneDanger">
          {err}
        </div>
      ) : null}

      <div className="space-y-3">
        {offers.map((offer) => {
          const isBusy = busy === offer.offerId
          return (
            <div
              key={offer.offerId}
              className="rounded-2xl border border-accentPrimary/40 bg-accentPrimary/5 p-4"
            >
              <div className="min-w-0">
                <div className="font-medium text-textPrimary">
                  {offer.serviceLabel}
                </div>
                <p className="mt-1 text-sm text-textMuted">
                  {offer.proHref ? (
                    <Link
                      href={offer.proHref}
                      className="font-medium text-textPrimary hover:underline"
                    >
                      {offer.proName}
                    </Link>
                  ) : (
                    <span className="font-medium text-textPrimary">
                      {offer.proName}
                    </span>
                  )}{' '}
                  · {formatWhen(offer.startAt, offer.timeZone)}
                </p>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  disabled={isBusy}
                  onClick={() => act(offer, 'CONFIRM')}
                  className="flex-1 rounded-xl bg-[image:var(--cta)] px-4 py-2.5 text-sm font-semibold text-onCta disabled:opacity-50"
                >
                  {isBusy ? '…' : 'Confirm'}
                </button>
                <button
                  disabled={isBusy}
                  onClick={() => act(offer, 'DECLINE')}
                  className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium text-textSecondary disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
