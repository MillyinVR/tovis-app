// app/(main)/booking/add-ons/ui/AddOnsClient.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type ServiceLocationType = 'SALON' | 'MOBILE'
type BookingSource = 'REQUESTED' | 'DISCOVERY' | 'AFTERCARE'

type AddOnDTO = {
  id: string // OfferingAddOn.id ✅
  serviceId: string
  title: string
  group: string | null
  price: string // "25.00"
  minutes: number
  sortOrder: number
  isRecommended: boolean
}

type Props = {
  holdId: string | null
  offeringId: string | null
  locationType: ServiceLocationType
  source: BookingSource
  mediaId: string | null
  addOns: AddOnDTO[]
  initialError?: string | null
}

function formatMinutes(min: number) {
  if (!Number.isFinite(min) || min <= 0) return null
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function formatMoneyLabel(v: string) {
  const n = Number(v)
  if (Number.isFinite(n)) return `$${n.toFixed(0)}`
  return `$${v}`
}

export default function AddOnsClient({
  holdId,
  offeringId,
  locationType,
  source,
  mediaId,
  addOns,
  initialError,
}: Props) {
  const router = useRouter()

  const [error, setError] = useState<string | null>(initialError ?? null)
  const [submitting, setSubmitting] = useState(false)

  // Optional hold countdown
  const [holdSecondsLeft, setHoldSecondsLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!holdId) return
    let alive = true

    ;(async () => {
      try {
        const res = await fetch(`/api/holds/${encodeURIComponent(holdId)}`, { cache: 'no-store' })
        const body = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok || !body?.ok) return

        const expiresAt = typeof body?.hold?.expiresAt === 'string' ? new Date(body.hold.expiresAt) : null
        if (!expiresAt || Number.isNaN(expiresAt.getTime())) return

        const tick = () => {
          const ms = expiresAt.getTime() - Date.now()
          const sec = Math.max(0, Math.floor(ms / 1000))
          setHoldSecondsLeft(sec)
        }

        tick()
        const t = window.setInterval(tick, 500)
        return () => window.clearInterval(t)
      } catch {
        // ignore
      }
    })()

    return () => {
      alive = false
    }
  }, [holdId])

  const defaultSelected = useMemo(() => {
    const next: Record<string, boolean> = {}
    for (const a of addOns) if (a.isRecommended) next[a.id] = true
    return next
  }, [addOns])

  const [selected, setSelected] = useState<Record<string, boolean>>(defaultSelected)

  // if addOns changes (rare), reset defaults once
  useEffect(() => {
    setSelected(defaultSelected)
  }, [defaultSelected])

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected])

  const totals = useMemo(() => {
    let centsLike = 0
    let minutes = 0

    for (const a of addOns) {
      if (!selected[a.id]) continue
      const price = Number(a.price ?? 0)
      if (Number.isFinite(price)) centsLike += Math.round(price * 100)
      minutes += Number(a.minutes ?? 0) || 0
    }

    return { extraPrice: centsLike / 100, extraMinutes: minutes }
  }, [addOns, selected])

  const grouped = useMemo(() => {
    const m = new Map<string, AddOnDTO[]>()
    for (const a of addOns) {
      const key = (a.group || 'Add-ons').trim()
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(a)
    }
    return Array.from(m.entries()).map(([group, items]) => ({
      group,
      items: items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    }))
  }, [addOns])

  async function finalize() {
    if (!holdId || !offeringId) {
      setError('Missing hold/offering. Please go back and pick a time again.')
      return
    }
    if (submitting) return
    if (holdSecondsLeft != null && holdSecondsLeft <= 0) {
      setError('That hold expired. Please go back and pick another time.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/bookings/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdId,
          offeringId,
          locationType,
          source,
          mediaId,
          addOnIds: selectedIds, // ✅ OfferingAddOn.id[]
        }),
      })

      const body = await res.json().catch(() => ({}))

      if (res.status === 401) {
        const from = `/booking/add-ons?holdId=${encodeURIComponent(holdId)}&offeringId=${encodeURIComponent(
          offeringId,
        )}&locationType=${encodeURIComponent(locationType)}&source=${encodeURIComponent(source)}${
          mediaId ? `&mediaId=${encodeURIComponent(mediaId)}` : ''
        }`
        router.push(`/login?from=${encodeURIComponent(from)}&reason=finalize`)
        return
      }

      if (!res.ok || !body?.ok) {
        setError(body?.error || 'Could not complete booking. Please try again.')
        return
      }

      const bookingId = typeof body?.booking?.id === 'string' ? body.booking.id : null
      if (!bookingId) {
        setError('Booking created but missing id. Please check your dashboard.')
        return
      }

      router.push(`/booking/${encodeURIComponent(bookingId)}`)
    } catch (e: any) {
      setError(e?.message || 'Network error completing booking.')
    } finally {
      setSubmitting(false)
    }
  }

  const holdLabel =
    typeof holdSecondsLeft === 'number'
      ? holdSecondsLeft <= 0
        ? 'Hold expired'
        : holdSecondsLeft < 60
          ? `Hold: ${holdSecondsLeft}s`
          : `Hold: ${Math.ceil(holdSecondsLeft / 60)}m`
      : null

  return (
    <main className="mx-auto max-w-180 px-4 pb-28 pt-10 text-textPrimary">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-black text-textSecondary">Review & customize</div>
          <h1 className="mt-1 text-[26px] font-black">Add-ons</h1>

          <div className="mt-2 text-[12px] font-semibold text-textSecondary">
            Optional upgrades that improve results + longevity.
            {holdLabel ? (
              <span
                className={[
                  'ml-2 font-black',
                  holdSecondsLeft != null && holdSecondsLeft < 60 ? 'text-toneDanger' : 'text-textPrimary',
                ].join(' ')}
              >
                {holdLabel}
              </span>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.back()}
          disabled={submitting}
          className="shrink-0 rounded-full border border-white/10 bg-bgPrimary/35 px-4 py-3 text-[12px] font-black text-textPrimary hover:bg-white/10 disabled:opacity-70"
        >
          ← Back
        </button>
      </div>

      {error ? (
        <div className="tovis-glass-soft mt-4 rounded-card p-4 text-sm font-semibold text-toneDanger">{error}</div>
      ) : null}

      {!error && addOns.length === 0 ? (
        <div className="tovis-glass-soft mt-4 rounded-card p-4 text-sm font-semibold text-textSecondary">
          No add-ons for this service right now. You’re good to go.
        </div>
      ) : addOns.length ? (
        <div className="mt-4 grid gap-3">
          {grouped.map(({ group, items }) => (
            <div key={group} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
              <div className="text-[12px] font-black text-textSecondary">{group}</div>

              <div className="mt-3 grid gap-2">
                {items.map((a) => {
                  const active = Boolean(selected[a.id])
                  const mins = formatMinutes(a.minutes)
                  const price = formatMoneyLabel(a.price)

                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelected((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
                      className={[
                        'rounded-card border px-4 py-3 text-left transition',
                        'border-white/10',
                        active ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-[13px] font-black">{a.title}</div>
                            {a.isRecommended ? (
                              <span
                                className={[
                                  'rounded-full border px-2 py-1 text-[10px] font-black',
                                  active
                                    ? 'border-bgPrimary/25 bg-bgPrimary/15 text-bgPrimary'
                                    : 'border-white/10 bg-bgPrimary/35 text-textPrimary',
                                ].join(' ')}
                              >
                                Recommended
                              </span>
                            ) : null}
                          </div>

                          <div className={['mt-2 text-[11px] font-semibold', active ? 'text-bgPrimary/90' : 'text-textSecondary'].join(' ')}>
                            {mins ? `+${mins}` : null}
                            {mins ? ' · ' : null}
                            From {price}
                          </div>
                        </div>

                        <div className="shrink-0">
                          <div
                            className={[
                              'grid h-6 w-6 place-items-center rounded-full border text-[12px] font-black',
                              active
                                ? 'border-bgPrimary/25 bg-bgPrimary/15 text-bgPrimary'
                                : 'border-white/10 bg-bgPrimary/35 text-textPrimary',
                            ].join(' ')}
                            aria-hidden="true"
                          >
                            {active ? '✓' : '+'}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="tovis-glass-soft rounded-card border border-white/10 px-4 py-3 text-[12px] font-semibold text-textSecondary">
            {selectedIds.length ? (
              <>
                Add-ons: <span className="font-black text-textPrimary">{selectedIds.length}</span>
                {totals.extraMinutes ? (
                  <span>
                    {' '}
                    · Time <span className="font-black text-textPrimary">+{totals.extraMinutes} min</span>
                  </span>
                ) : null}
                {totals.extraPrice ? (
                  <span>
                    {' '}
                    · Est. <span className="font-black text-textPrimary">+${totals.extraPrice.toFixed(0)}</span>
                  </span>
                ) : null}
              </>
            ) : (
              <>No add-ons selected</>
            )}
          </div>
        </div>
      ) : null}

      {/* Sticky bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-bgPrimary/70 backdrop-blur">
        <div className="mx-auto max-w-180 px-4 py-3">
          <div className="tovis-glass-soft rounded-card border border-white/10 px-4 py-3">
            <button
              type="button"
              onClick={() => void finalize()}
              disabled={submitting || !holdId || !offeringId || (holdSecondsLeft != null && holdSecondsLeft <= 0)}
              className="flex h-12 w-full items-center justify-center rounded-full border border-white/10 bg-accentPrimary text-[14px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-70"
            >
              {submitting ? 'Booking…' : 'Complete booking'}
            </button>

            <button
              type="button"
              onClick={() => router.back()}
              disabled={submitting}
              className="mt-2 flex h-12 w-full items-center justify-center rounded-full border border-white/10 bg-bgPrimary/35 text-[14px] font-black text-textPrimary hover:bg-white/10 disabled:opacity-70"
            >
              Skip
            </button>

            <div className="mt-2 text-center text-[11px] font-semibold text-textSecondary">
              No charge until the pro confirms.
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
