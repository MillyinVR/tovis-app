// app/(main)/booking/add-ons/ui/AddOnsClient.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { endAvailabilityMetric } from '../../AvailabilityDrawer/perf/availabilityPerf'
import type {
  BookingSource,
  ServiceLocationType,
} from '../../AvailabilityDrawer/types'

type AddOnDTO = {
  id: string
  serviceId: string
  title: string
  group: string | null
  price: string
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
  lookPostId: string | null
  addOns: AddOnDTO[]
  initialError?: string | null
  initialSelectedIds?: string[]
}

const MAX_ADD_ON_IDS = 50

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function formatMinutes(min: number): string | null {
  if (!Number.isFinite(min) || min <= 0) return null
  if (min < 60) return `${min} min`

  const hours = Math.floor(min / 60)
  const minutes = min % 60

  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

function formatMoneyLabel(value: string): string {
  const amount = Number(value)
  if (Number.isFinite(amount)) return `$${amount.toFixed(0)}`
  return `$${value}`
}

function parseCommaIds(raw: string | null, max: number): string[] {
  if (!raw) return []

  const result: string[] = []
  const seen = new Set<string>()

  for (const part of raw.split(',')) {
    const normalized = part.trim()
    if (!normalized) continue
    if (seen.has(normalized)) continue

    seen.add(normalized)
    result.push(normalized)

    if (result.length >= max) break
  }

  return result
}

function buildRecommendedMap(addOns: AddOnDTO[]): Record<string, boolean> {
  const next: Record<string, boolean> = {}

  for (const addOn of addOns) {
    if (addOn.isRecommended) {
      next[addOn.id] = true
    }
  }

  return next
}

function buildSelectedMapFromIds(
  addOns: AddOnDTO[],
  ids: string[],
): Record<string, boolean> {
  const allowedIds = new Set(addOns.map((addOn) => addOn.id))
  const next: Record<string, boolean> = {}

  for (const id of ids) {
    if (allowedIds.has(id)) {
      next[id] = true
    }
  }

  return next
}

function selectedIdsFromMap(selected: Record<string, boolean>): string[] {
  return Object.keys(selected).filter((id) => Boolean(selected[id]))
}

function keyFromIds(ids: string[]): string {
  return ids.slice().sort().join(',')
}

function buildContinueMetricKey(holdId: string): string {
  return `continue:${holdId}`
}

function getExpiresAtFromHoldResponse(raw: unknown): Date | null {
  if (!isRecord(raw)) return null
  if (raw.ok !== true) return null
  if (!isRecord(raw.hold)) return null

  const expiresAt = readString(raw.hold.expiresAt)
  if (!expiresAt) return null

  const parsed = new Date(expiresAt)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getFinalizeErrorMessage(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return readString(raw.error)
}

function getFinalizeBookingId(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  if (raw.ok !== true) return null
  if (!isRecord(raw.booking)) return null

  return readString(raw.booking.id)
}

export default function AddOnsClient({
  holdId,
  offeringId,
  locationType,
  source,
  mediaId,
  lookPostId,
  addOns,
  initialError,
  initialSelectedIds,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const searchString = searchParams.toString()

  const searchParamsSnapshot = useMemo(() => {
    return new URLSearchParams(searchString)
  }, [searchString])

  const urlAddOnIdsRaw = useMemo(() => {
    return searchParamsSnapshot.get('addOnIds')
  }, [searchParamsSnapshot])

  const urlHasAddOnIds = useMemo(() => {
    return Boolean(urlAddOnIdsRaw?.trim())
  }, [urlAddOnIdsRaw])

  const [error, setError] = useState<string | null>(initialError ?? null)
  const [submitting, setSubmitting] = useState(false)
  const [touched, setTouched] = useState(false)
  const [holdSecondsLeft, setHoldSecondsLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!holdId) {
      setHoldSecondsLeft(null)
      return
    }

    let cancelled = false
    let intervalId: number | null = null

    void (async () => {
      try {
        const response = await fetch(`/api/holds/${encodeURIComponent(holdId)}`, {
          cache: 'no-store',
        })

        const raw: unknown = await response.json().catch(() => null)

        if (cancelled) return
        if (!response.ok) return

        const expiresAt = getExpiresAtFromHoldResponse(raw)
        if (!expiresAt) return

        const tick = () => {
          const millisecondsRemaining = expiresAt.getTime() - Date.now()
          const secondsRemaining = Math.max(
            0,
            Math.floor(millisecondsRemaining / 1000),
          )

          setHoldSecondsLeft(secondsRemaining)
        }

        tick()
        intervalId = window.setInterval(tick, 500)
      } catch {
        // ignore timer fetch failures
      }
    })()

    return () => {
      cancelled = true
      if (intervalId != null) {
        window.clearInterval(intervalId)
      }
    }
  }, [holdId])

  const recommendedMap = useMemo(() => buildRecommendedMap(addOns), [addOns])

  const urlSelectedIds = useMemo(() => {
    return parseCommaIds(urlAddOnIdsRaw, MAX_ADD_ON_IDS)
  }, [urlAddOnIdsRaw])

  const initialSelectedMap = useMemo(() => {
    if (Array.isArray(initialSelectedIds) && initialSelectedIds.length > 0) {
      return buildSelectedMapFromIds(addOns, initialSelectedIds)
    }

    if (urlSelectedIds.length > 0) {
      return buildSelectedMapFromIds(addOns, urlSelectedIds)
    }

    return recommendedMap
  }, [addOns, initialSelectedIds, urlSelectedIds, recommendedMap])

  const [selected, setSelected] =
    useState<Record<string, boolean>>(initialSelectedMap)

  useEffect(() => {
    setSelected((current) => {
      const currentKey = keyFromIds(selectedIdsFromMap(current))
      const nextKey = keyFromIds(selectedIdsFromMap(initialSelectedMap))

      return currentKey === nextKey ? current : initialSelectedMap
    })
  }, [initialSelectedMap])

  const selectedIds = useMemo(() => selectedIdsFromMap(selected), [selected])
  const selectedKey = useMemo(() => keyFromIds(selectedIds), [selectedIds])

  useEffect(() => {
    if (!pathname) return
    if (!touched && !urlHasAddOnIds) return

    const currentKey = keyFromIds(
      parseCommaIds(urlAddOnIdsRaw, MAX_ADD_ON_IDS),
    )

    if (currentKey === selectedKey) return

    const nextSearchParams = new URLSearchParams(searchString)

    if (selectedIds.length > 0) {
      nextSearchParams.set('addOnIds', selectedKey)
    } else {
      nextSearchParams.delete('addOnIds')
    }

    const nextHref = nextSearchParams.toString()
      ? `${pathname}?${nextSearchParams.toString()}`
      : pathname

    router.replace(nextHref, { scroll: false })
  }, [
    pathname,
    router,
    searchString,
    selectedIds.length,
    selectedKey,
    touched,
    urlAddOnIdsRaw,
    urlHasAddOnIds,
  ])

  const totals = useMemo(() => {
    let centsLike = 0
    let minutes = 0

    for (const addOn of addOns) {
      if (!selected[addOn.id]) continue

      const price = Number(addOn.price ?? 0)
      if (Number.isFinite(price)) {
        centsLike += Math.round(price * 100)
      }

      minutes += Number(addOn.minutes ?? 0) || 0
    }

    return {
      extraPrice: centsLike / 100,
      extraMinutes: minutes,
    }
  }, [addOns, selected])

  const grouped = useMemo(() => {
    const groups = new Map<string, AddOnDTO[]>()

    for (const addOn of addOns) {
      const groupKey = (addOn.group || 'Add-ons').trim()
      const existing = groups.get(groupKey)

      if (existing) {
        existing.push(addOn)
      } else {
        groups.set(groupKey, [addOn])
      }
    }

    return Array.from(groups.entries()).map(([group, items]) => ({
      group,
      items: items.sort((left, right) => {
        return (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
      }),
    }))
  }, [addOns])

  async function finalize(): Promise<void> {
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
      const response = await fetch('/api/bookings/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdId,
          offeringId,
          locationType,
          source,
          mediaId,
          lookPostId,
          addOnIds: selectedIds,
        }),
      })

      const raw: unknown = await response.json().catch(() => null)

      if (response.status === 401) {
        const fromQuery = new URLSearchParams({
          holdId,
          offeringId,
          locationType,
          source,
        })

        if (mediaId) {
          fromQuery.set('mediaId', mediaId)
        }

        if (lookPostId) {
          fromQuery.set('lookPostId', lookPostId)
        }

        if (selectedIds.length > 0) {
          fromQuery.set('addOnIds', selectedKey)
        }

        const from = `/booking/add-ons?${fromQuery.toString()}`
        router.push(`/login?from=${encodeURIComponent(from)}&reason=finalize`)
        return
      }

      const bookingId = getFinalizeBookingId(raw)

      if (!response.ok || !bookingId) {
        const apiError = getFinalizeErrorMessage(raw)

        if (response.ok && !bookingId) {
          setError(
            'Booking created but missing id. Please check your dashboard.',
          )
          return
        }

        setError(apiError || 'Could not complete booking. Please try again.')
        return
      }

      router.push(`/booking/${encodeURIComponent(bookingId)}`)
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? error.message
          : 'Network error completing booking.',
      )
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

  useEffect(() => {
    if (!holdId) return

    const continueMetricKey = buildContinueMetricKey(holdId)
    let rafId = 0

    rafId = window.requestAnimationFrame(() => {
      endAvailabilityMetric({
        metric: 'continue_to_add_ons_ms',
        key: continueMetricKey,
        meta: {
          holdId,
          offeringId,
          locationType,
          bookingSource: source,
          mediaId,
          lookPostId,
          addOnCount: addOns.length,
          readyTarget: 'booking-add-ons-continue-button',
        },
      })
    })

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [holdId, offeringId, locationType, source, mediaId, lookPostId, addOns.length])

  return (
    <main className="mx-auto max-w-180 px-4 pb-28 pt-10 text-textPrimary">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-black text-textSecondary">
            Review & customize
          </div>
          <h1 className="mt-1 text-[26px] font-black">Add-ons</h1>

          <div className="mt-2 text-[12px] font-semibold text-textSecondary">
            Optional upgrades that improve results + longevity.
            {holdLabel ? (
              <span
                className={[
                  'ml-2 font-black',
                  holdSecondsLeft != null && holdSecondsLeft < 60
                    ? 'text-toneDanger'
                    : 'text-textPrimary',
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
        <div className="tovis-glass-soft mt-4 rounded-card p-4 text-sm font-semibold text-toneDanger">
          {error}
        </div>
      ) : null}

      {!error && addOns.length === 0 ? (
        <div className="tovis-glass-soft mt-4 rounded-card p-4 text-sm font-semibold text-textSecondary">
          No add-ons for this service right now. You’re good to go.
        </div>
      ) : addOns.length ? (
        <div data-testid="booking-add-ons-list" className="mt-4 grid gap-3">
          {grouped.map(({ group, items }) => (
            <div
              key={group}
              className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4"
            >
              <div className="text-[12px] font-black text-textSecondary">
                {group}
              </div>

              <div className="mt-3 grid gap-2">
                {items.map((addOn) => {
                  const active = Boolean(selected[addOn.id])
                  const minutesLabel = formatMinutes(addOn.minutes)
                  const priceLabel = formatMoneyLabel(addOn.price)

                  return (
                    <button
                      key={addOn.id}
                      type="button"
                      onClick={() => {
                        setTouched(true)
                        setSelected((previous) => ({
                          ...previous,
                          [addOn.id]: !previous[addOn.id],
                        }))
                      }}
                      className={[
                        'rounded-card border px-4 py-3 text-left transition',
                        'border-white/10',
                        active
                          ? 'bg-accentPrimary text-bgPrimary'
                          : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-[13px] font-black">
                              {addOn.title}
                            </div>

                            {addOn.isRecommended ? (
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

                          <div
                            className={[
                              'mt-2 text-[11px] font-semibold',
                              active ? 'text-bgPrimary/90' : 'text-textSecondary',
                            ].join(' ')}
                          >
                            {minutesLabel ? `+${minutesLabel}` : null}
                            {minutesLabel ? ' · ' : null}
                            From {priceLabel}
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
                Add-ons:{' '}
                <span className="font-black text-textPrimary">
                  {selectedIds.length}
                </span>
                {totals.extraMinutes ? (
                  <span>
                    {' '}
                    · Time{' '}
                    <span className="font-black text-textPrimary">
                      +{totals.extraMinutes} min
                    </span>
                  </span>
                ) : null}
                {totals.extraPrice ? (
                  <span>
                    {' '}
                    · Est.{' '}
                    <span className="font-black text-textPrimary">
                      +${totals.extraPrice.toFixed(0)}
                    </span>
                  </span>
                ) : null}
              </>
            ) : (
              <>No add-ons selected</>
            )}
          </div>
        </div>
      ) : null}

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-bgPrimary/70 backdrop-blur">
        <div className="mx-auto max-w-180 px-4 py-3">
          <div className="tovis-glass-soft rounded-card border border-white/10 px-4 py-3">
            <button
              data-testid="booking-add-ons-continue-button"
              type="button"
              onClick={() => void finalize()}
              disabled={
                submitting ||
                !holdId ||
                !offeringId ||
                (holdSecondsLeft != null && holdSecondsLeft <= 0)
              }
              className="flex h-12 w-full items-center justify-center rounded-full border border-white/10 bg-accentPrimary text-[14px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-70"
            >
              {submitting ? 'Booking…' : 'Complete booking'}
            </button>

            <button
              data-testid="booking-add-ons-skip-button"
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