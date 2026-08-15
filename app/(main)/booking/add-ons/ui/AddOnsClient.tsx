// app/(main)/booking/add-ons/ui/AddOnsClient.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { endAvailabilityMetric } from '../../AvailabilityDrawer/perf/availabilityPerf'
import { formatRoundedDollars } from '@/lib/money'
import RemoteImage from '@/app/_components/media/RemoteImage'
import type { AddOnsContext } from '@/lib/booking/addOnsContext'
import { zClass } from '@/lib/zIndex'
import type {
  ClientBookingSource,
  ServiceLocationType,
} from '../../AvailabilityDrawer/types'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'
import { isRecord } from '@/lib/guards'
import SaveCardStep from '@/app/_components/payments/SaveCardStep'
// Shared wire DTO for GET /api/v1/offerings/add-ons — single source of truth for
// the add-on shape (web + native). The `id` is the OfferingAddOn link id.
import type { OfferingAddOnItemDTO as AddOnDTO } from '@/lib/dto'

type Props = {
  /** Look / pro / time / hold carried over from the sheet. */
  context: AddOnsContext
  holdId: string | null
  offeringId: string | null
  locationType: ServiceLocationType
  source: ClientBookingSource
  mediaId: string | null
  lookPostId: string | null
  addOns: AddOnDTO[]
  selectionPrompt?: string | null
  initialError?: string | null
  initialSelectedIds?: string[]
  /**
   * The pro's no-show / late-cancel fee policy (M15). Non-null only when the pro
   * charges fees; when present the client must tick the agreement checkbox before
   * booking, and acceptance is sent to finalize.
   */
  cancellationPolicy?: string | null
}

const MAX_ADD_ON_IDS = 50

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
  return formatRoundedDollars(value) ?? `$${value}`
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

type SyncFailure = {
  message: string
  /**
   * True when the server refused the WINDOW (it no longer fits). False for a
   * refusal that says nothing about the add-on — a rate limit, a network blip —
   * where blaming the add-on would be a lie.
   */
  aboutTheWindow: boolean
}

/**
 * Re-size the hold to `ids` so the reservation covers what finalize will take.
 *
 * Resolves to the server's refusal when the widened window no longer fits (the
 * slot's tail was taken, or the appointment would now run past the pro's day)
 * and `null` on success — the caller un-ticks on a refusal, so the client
 * learns HERE rather than at the end of checkout (B1-A).
 */
async function syncHoldAddOns(
  holdId: string,
  ids: string[],
): Promise<SyncFailure | null> {
  const response = await fetch(`/api/v1/holds/${encodeURIComponent(holdId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addOnIds: ids }),
  })

  if (response.ok) return null

  const raw: unknown = await response.json().catch(() => null)
  const message =
    getFinalizeErrorMessage(raw) ?? 'That time is no longer available.'

  return { message, aboutTheWindow: response.status !== 429 }
}

/**
 * The refusal a client should read: the server's reason is about the WINDOW
 * ("outside working hours", "that time is booked"), which is confusing next to
 * an add-on they just ticked. Name the add-on that pushed it over, and what to
 * do about it.
 */
function describeSyncFailure(args: {
  failure: SyncFailure
  addedIds: string[]
  addOns: AddOnDTO[]
}): string {
  const { message } = args.failure

  if (!args.failure.aboutTheWindow) return message
  if (args.addedIds.length === 0) return message

  const titles = args.addedIds
    .map((id) => args.addOns.find((addOn) => addOn.id === id)?.title)
    .filter((title): title is string => Boolean(title))

  if (titles.length === 1) {
    return `“${titles[0]}” doesn’t fit this appointment time — ${message} Pick an earlier time, or book without it.`
  }

  return `Those add-ons don’t fit this appointment time — ${message} Pick an earlier time, or book without them.`
}

/**
 * K16 — the machine-readable refusal code, alongside the human sentence.
 *
 * `CARD_ON_FILE_REQUIRED` is the one refusal on this path the CLIENT can clear
 * without leaving the page, so it is the one the flow branches on rather than
 * simply printing.
 */
function getFinalizeErrorCode(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return readString(raw.code)
}

function getFinalizeBookingId(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  if (raw.ok !== true) return null
  if (!isRecord(raw.booking)) return null

  return readString(raw.booking.id)
}

export default function AddOnsClient({
  context,
  holdId,
  offeringId,
  locationType,
  source,
  mediaId,
  lookPostId,
  addOns,
  selectionPrompt,
  initialError,
  initialSelectedIds,
  cancellationPolicy,
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
  /** K16: finalize refused for a missing card on file; show the inline step. */
  const [needsCard, setNeedsCard] = useState(false)
  const [touched, setTouched] = useState(false)
  const [holdSecondsLeft, setHoldSecondsLeft] = useState<number | null>(null)
  // M15: when the pro charges no-show/late-cancel fees, the client must agree to
  // the policy before booking. No policy → no gate.
  const [policyAccepted, setPolicyAccepted] = useState(false)

  useEffect(() => {
    if (!holdId) {
      setHoldSecondsLeft(null)
      return
    }

    let cancelled = false
    let intervalId: number | null = null

    void (async () => {
      try {
        const response = await fetch(`/api/v1/holds/${encodeURIComponent(holdId)}`, {
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

  // Set once the hold sync below has produced an answer, success or refusal.
  // Declared here because the adopt effect immediately below reads it.
  const serverAnsweredRef = useRef(false)

  // Adopt the URL / recommended defaults only until the selection has an owner.
  // Once the client has touched it, or the server has answered about it, those
  // defaults are stale: re-applying them would re-tick an add-on the hold was
  // just refused for, and the sync below would ask again — forever.
  useEffect(() => {
    if (touched || serverAnsweredRef.current) return

    setSelected((current) => {
      const currentKey = keyFromIds(selectedIdsFromMap(current))
      const nextKey = keyFromIds(selectedIdsFromMap(initialSelectedMap))

      return currentKey === nextKey ? current : initialSelectedMap
    })
  }, [initialSelectedMap, touched])

  const selectedIds = useMemo(() => selectedIdsFromMap(selected), [selected])
  const selectedKey = useMemo(() => keyFromIds(selectedIds), [selectedIds])

  // What the HOLD currently reserves. The drawer creates it for the base
  // service, so the starting point is an empty selection; every change from
  // here is pushed to the server before it can be booked (B1-A). Recommended
  // add-ons arrive pre-ticked, so this commonly fires once on mount.
  const [syncedKey, setSyncedKey] = useState<string>('')
  const [syncingHold, setSyncingHold] = useState(false)
  const syncSequenceRef = useRef(0)

  const syncedIds = useMemo(
    () => (syncedKey ? syncedKey.split(',') : []),
    [syncedKey],
  )

  useEffect(() => {
    if (!holdId) return
    if (selectedKey === syncedKey) return

    const sequence = ++syncSequenceRef.current
    const requestedIds = selectedIds
    let cancelled = false

    setSyncingHold(true)

    void (async () => {
      const failure = await syncHoldAddOns(holdId, requestedIds).catch(
        (): SyncFailure => ({
          message:
            'Couldn’t update your hold. Check your connection and try again.',
          aboutTheWindow: false,
        }),
      )

      // A newer toggle already went out; that response is the one that counts.
      if (cancelled || sequence !== syncSequenceRef.current) return

      serverAnsweredRef.current = true

      if (failure) {
        setError(
          describeSyncFailure({
            failure,
            addedIds: requestedIds.filter((id) => !syncedIds.includes(id)),
            addOns,
          }),
        )
        // Snap back to what the hold actually reserves — the refused add-on was
        // never held, so leaving it ticked would re-create the dead end.
        setSelected(buildSelectedMapFromIds(addOns, syncedIds))
      } else {
        setSyncedKey(keyFromIds(requestedIds))
        setError(null)
      }

      setSyncingHold(false)
    })()

    return () => {
      cancelled = true
    }
  }, [addOns, holdId, selectedIds, selectedKey, syncedIds, syncedKey])

  // The URL carries what the hold actually RESERVES, never a selection the
  // server has not accepted — otherwise a reload (or the login round-trip)
  // would restore add-ons that were refused.
  useEffect(() => {
    if (!pathname) return
    if (!touched && !urlHasAddOnIds) return

    const currentKey = keyFromIds(
      parseCommaIds(urlAddOnIdsRaw, MAX_ADD_ON_IDS),
    )

    if (currentKey === syncedKey) return

    const nextSearchParams = new URLSearchParams(searchString)

    if (syncedIds.length > 0) {
      nextSearchParams.set('addOnIds', syncedKey)
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
    syncedIds.length,
    syncedKey,
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

    // Never book a selection the hold has not been widened to cover — that is
    // the exact gap B1-A closed.
    if (syncingHold || selectedKey !== syncedKey) {
      setError('Still updating your add-ons — one moment.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'booking-finalize',
        entityId: holdId,
        action: 'complete',
      })

      const response = await fetch('/api/v1/bookings/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...idempotencyHeaders(idempotencyKey),
        },
        body: JSON.stringify({
          holdId,
          offeringId,
          locationType,
          source,
          mediaId,
          lookPostId,
          addOnIds: selectedIds,
          cancellationPolicyAccepted: policyAccepted,
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

        // K16: the pro requires a card on file and this client has none. The
        // hold is deliberately still standing (the requirement is enforced at
        // finalize, not at hold creation), so the client can save a card right
        // here and finish inside the same reservation instead of losing the
        // slot and starting over.
        if (getFinalizeErrorCode(raw) === 'CARD_ON_FILE_REQUIRED') {
          setNeedsCard(true)
          setError(null)
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

  const contextTitle = [context?.cover?.lookName, context?.proName]
    .filter(Boolean)
    .join(' · ')

  return (
    <main className="mx-auto max-w-180 px-4 pb-28 pt-6 text-textPrimary">
      {/* CONTEXT STRIP — the look, pro, time and hold timer follow you from the
          sheet, so this reads as step two rather than a new screen. Rendered
          only when something survived; a strip with nothing in it is worse than
          no strip. */}
      {contextTitle || context?.whenLabel || holdLabel ? (
        <div
          data-testid="add-ons-context-strip"
          className="mb-5 flex items-center gap-3 rounded-[14px] border border-textPrimary/10 bg-textPrimary/[0.03] px-[11px] py-[9px]"
        >
          {context?.cover?.imageUrl ? (
            <RemoteImage
              src={context.cover.imageUrl}
              alt=""
              className="h-[38px] w-[38px] shrink-0 rounded-[10px] object-cover"
              width={76}
              height={76}
            />
          ) : null}

          <div className="min-w-0 flex-1">
            {contextTitle ? (
              <div className="truncate text-[13px] font-black text-textPrimary">
                {contextTitle}
              </div>
            ) : null}
            {context?.whenLabel ? (
              <div className="mt-[2px] truncate text-[11px] font-semibold text-textSecondary">
                {context.whenLabel}
              </div>
            ) : null}
          </div>

          {holdLabel ? (
            <span
              className={[
                'shrink-0 text-[11px] font-black tabular-nums',
                holdSecondsLeft != null && holdSecondsLeft < 60
                  ? 'text-toneDanger'
                  : 'text-toneWarn',
              ].join(' ')}
            >
              {holdLabel}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-black text-textSecondary">
            Review & customize
          </div>
          <h1 className="mt-1 text-[26px] font-black">Add-ons</h1>

          <div className="mt-2 text-[12px] font-semibold text-textSecondary">
            Optional upgrades that improve results + longevity.
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.back()}
          disabled={submitting}
          className="shrink-0 rounded-full border border-textPrimary/10 bg-bgPrimary/35 px-4 py-3 text-[12px] font-black text-textPrimary hover:bg-textPrimary/10 disabled:opacity-70"
        >
          ← Back
        </button>
      </div>

      {error ? (
        <div className="tovis-glass-soft mt-4 rounded-card p-4 text-sm font-semibold text-toneDanger">
          {error}
        </div>
      ) : null}

      {!error && selectionPrompt ? (
        <div
          data-testid="booking-selection-prompt"
          className="tovis-glass-soft mt-4 rounded-card p-4 text-sm font-semibold leading-6 text-textPrimary"
        >
          {selectionPrompt}
        </div>
      ) : null}

      {/* K16 — the inline add-card step. Neutral copy by design: this client is
          never told that a policy exists about them, only what this appointment
          needs. The hold is still running behind this step. */}
      {needsCard ? (
        <div
          data-testid="booking-card-on-file-step"
          className="tovis-glass mt-4 rounded-card border border-textPrimary/10 bg-bgSecondary p-4"
        >
          <div className="text-[13px] font-black text-textPrimary">
            Add a card to finish booking
          </div>
          <div className="mt-1 text-xs font-semibold leading-5 text-textSecondary">
            This appointment needs a card on file. You won’t be charged now —
            your time slot is still held while you add it.
          </div>

          <SaveCardStep
            saveLabel="Save card & book"
            onSaved={() => {
              setNeedsCard(false)
              // Retry the finalize the card was blocking. The hold has not moved,
              // so this is the same booking the client already confirmed.
              void finalize()
            }}
            onCancel={() => setNeedsCard(false)}
          />
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
              className="tovis-glass rounded-card border border-textPrimary/10 bg-bgSecondary p-4"
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
                        'border-textPrimary/10',
                        active
                          ? 'bg-accentPrimary text-bgPrimary'
                          : 'bg-bgPrimary/35 text-textPrimary hover:bg-textPrimary/10',
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
                                    : 'border-textPrimary/10 bg-bgPrimary/35 text-textPrimary',
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
                                : 'border-textPrimary/10 bg-bgPrimary/35 text-textPrimary',
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

          <div className="tovis-glass-soft rounded-card border border-textPrimary/10 px-4 py-3 text-[12px] font-semibold text-textSecondary">
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

      <div className={`fixed bottom-0 left-0 right-0 ${zClass.sticky} border-t border-textPrimary/10 bg-bgPrimary/70 backdrop-blur`}>
        <div className="mx-auto max-w-180 px-4 py-3">
          <div className="tovis-glass-soft rounded-card border border-textPrimary/10 px-4 py-3">
            {cancellationPolicy ? (
              <label className="mb-3 flex items-start gap-2 rounded-card border border-textPrimary/10 bg-bgPrimary/35 px-3 py-2 text-left">
                <input
                  data-testid="booking-cancellation-policy-checkbox"
                  type="checkbox"
                  checked={policyAccepted}
                  onChange={(e) => setPolicyAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span className="text-[12px] font-semibold text-textSecondary">
                  {`${cancellationPolicy} I agree to this cancellation policy.`}
                </span>
              </label>
            ) : null}

            <button
              data-testid="booking-add-ons-continue-button"
              type="button"
              onClick={() => void finalize()}
              disabled={
                submitting ||
                syncingHold ||
                !holdId ||
                !offeringId ||
                (holdSecondsLeft != null && holdSecondsLeft <= 0) ||
                (cancellationPolicy != null && !policyAccepted)
              }
              className="flex h-12 w-full items-center justify-center rounded-full border border-textPrimary/10 bg-accentPrimary text-[14px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-70"
            >
              {submitting
                ? 'Booking…'
                : syncingHold
                  ? 'Updating your hold…'
                  : 'Complete booking'}
            </button>

            <button
              data-testid="booking-add-ons-skip-button"
              type="button"
              onClick={() => router.back()}
              disabled={submitting}
              className="mt-2 flex h-12 w-full items-center justify-center rounded-full border border-textPrimary/10 bg-bgPrimary/35 text-[14px] font-black text-textPrimary hover:bg-textPrimary/10 disabled:opacity-70"
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
