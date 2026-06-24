'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { safeJson } from '@/lib/http'

type Offer = {
  recipientId: string
  status: string
  expiresAt: string | null
  expired: boolean
  proName: string
  proHref: string
  avatarUrl: string | null
  serviceLabel: string
  startAt: string
  endAt: string | null
  timeZone: string
  locationType: string
  note: string | null
  incentiveLabel: string | null
  claimHref: string
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatWhen(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toLocaleString()
  }
}

export default function OffersListClient() {
  const router = useRouter()
  const params = useSearchParams()
  const acceptId = params.get('accept')
  const now = useNow(1000)

  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/client/priority-offer')
      const data = await safeJson(res)
      if (res.ok && data && typeof data === 'object' && 'offers' in data) {
        setOffers((data as { offers: Offer[] }).offers)
      }
    } catch {
      setErr('Failed to load your offers.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleClaim(offer: Offer) {
    setBusy(offer.recipientId)
    setErr(null)
    try {
      const res = await fetch(
        `/api/client/priority-offer/${offer.recipientId}/accept`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const data = await safeJson(res)
        const msg =
          data && typeof data === 'object' && 'error' in data
            ? (data as { error: string }).error
            : 'This offer is no longer available.'
        setErr(msg)
        await load()
        return
      }
      router.push(offer.claimHref)
    } catch {
      setErr('Something went wrong. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function handlePass(offer: Offer) {
    setBusy(offer.recipientId)
    setErr(null)
    try {
      const res = await fetch(
        `/api/client/priority-offer/${offer.recipientId}/decline`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const data = await safeJson(res)
        const msg =
          data && typeof data === 'object' && 'error' in data
            ? (data as { error: string }).error
            : 'Could not pass on this offer.'
        setErr(msg)
      }
      await load()
    } catch {
      setErr('Something went wrong. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-textMuted">
        Loading your offers…
      </div>
    )
  }

  const sorted = acceptId
    ? [
        ...offers.filter((o) => o.recipientId === acceptId),
        ...offers.filter((o) => o.recipientId !== acceptId),
      ]
    : offers

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-textPrimary">Your priority offers</h1>
        <p className="text-sm text-textMuted">
          You&rsquo;re first in line for these last-minute openings. Claim before
          the timer runs out, or pass to give it to the next person.
        </p>
      </header>

      {err && (
        <div className="rounded-xl border border-toneDanger/30 bg-toneDanger/10 px-4 py-3 text-sm text-toneDanger">
          {err}
        </div>
      )}

      {sorted.length === 0 && (
        <p className="py-10 text-center text-textMuted">
          No active offers right now. When a spot opens up for a service you&rsquo;re
          waitlisted for, you&rsquo;ll get first dibs here.
        </p>
      )}

      <div className="space-y-3">
        {sorted.map((offer) => {
          const isHighlighted = offer.recipientId === acceptId
          const isBusy = busy === offer.recipientId
          const remainingMs = offer.expiresAt
            ? new Date(offer.expiresAt).getTime() - now
            : 0
          const isExpired = offer.expired || remainingMs <= 0
          const isUrgent = !isExpired && remainingMs <= 5 * 60 * 1000

          return (
            <div
              key={offer.recipientId}
              className={`rounded-2xl border p-4 ${
                isHighlighted
                  ? 'border-accentPrimary/50 bg-accentPrimary/5'
                  : 'border-white/10 bg-bgSecondary'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-textPrimary">
                      {offer.serviceLabel}
                    </span>
                    {offer.incentiveLabel ? (
                      <span className="inline-flex items-center rounded-full bg-accentPrimary/12 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-accentPrimary">
                        ✦ {offer.incentiveLabel}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1 text-sm text-textMuted">
                    <Link
                      href={offer.proHref}
                      className="font-medium text-textPrimary hover:underline"
                    >
                      {offer.proName}
                    </Link>{' '}
                    · {formatWhen(offer.startAt, offer.timeZone)}
                  </p>

                  {offer.note ? (
                    <p className="mt-1 text-sm text-textSecondary">{offer.note}</p>
                  ) : null}
                </div>

                {!isExpired ? (
                  <div
                    className={`shrink-0 rounded-full px-3 py-1 font-mono text-[12px] font-bold tabular-nums ${
                      isUrgent
                        ? 'bg-toneDanger/15 text-toneDanger'
                        : 'bg-white/10 text-textPrimary'
                    }`}
                    aria-label="Time left to claim"
                  >
                    {formatCountdown(remainingMs)}
                  </div>
                ) : (
                  <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-[12px] font-medium text-textMuted">
                    Expired
                  </span>
                )}
              </div>

              {!isExpired ? (
                <div className="mt-4 flex gap-2">
                  <button
                    disabled={isBusy}
                    onClick={() => handleClaim(offer)}
                    className="flex-1 rounded-xl bg-[image:var(--cta)] px-4 py-2.5 text-sm font-semibold text-onCta disabled:opacity-50"
                  >
                    {isBusy ? '…' : 'Claim it'}
                  </button>
                  <button
                    disabled={isBusy}
                    onClick={() => handlePass(offer)}
                    className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium text-textSecondary disabled:opacity-50"
                  >
                    Pass
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-sm text-textMuted">
                  This window has passed. The opening may have gone to the next
                  person in line.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
