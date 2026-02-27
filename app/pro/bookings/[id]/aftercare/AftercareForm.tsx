// app/pro/bookings/[id]/aftercare/AftercareForm.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getZonedParts, sanitizeTimeZone, zonedTimeToUtc } from '@/lib/timeZone'

type MediaType = 'IMAGE' | 'VIDEO'
type MediaVisibility = 'PUBLIC' | 'PRO_CLIENT'
type Role = 'CLIENT' | 'PRO' | 'ADMIN'
type MediaPhase = 'BEFORE' | 'AFTER' | 'OTHER'

type MediaItem = {
  id: string
  mediaType: MediaType
  visibility: MediaVisibility
  uploadedByRole: Role | null
  reviewId: string | null
  createdAt: string
  phase: MediaPhase

  // ✅ UI should use these (signed/public HTTP URLs)
  renderUrl: string | null
  renderThumbUrl: string | null

  // Optional debug fields
  url?: string | null
  thumbUrl?: string | null
}

type RebookMode = 'NONE' | 'BOOKED_NEXT_APPOINTMENT' | 'RECOMMENDED_WINDOW'

type RecommendedProduct = {
  id: string
  name: string
  url: string
  note?: string
}

type Props = {
  bookingId: string
  timeZone: string

  existingNotes: string

  existingRebookedFor: string | null
  existingRebookMode?: RebookMode | null
  existingRebookWindowStart?: string | null
  existingRebookWindowEnd?: string | null

  existingMedia: MediaItem[]
  existingRecommendedProducts?: RecommendedProduct[]
}

// Keep this EXACTLY aligned with useProSession.ts
const FORCE_EVENT = 'tovis:pro-session:force'

const MAX_PRODUCTS = 10
const PRODUCT_NAME_MAX = 80
const PRODUCT_NOTE_MAX = 140
const NOTES_MAX = 4000

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/pro'
  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeFrom(from: string) {
  const trimmed = from.trim()
  if (!trimmed) return '/pro'
  if (!trimmed.startsWith('/')) return '/pro'
  if (trimmed.startsWith('//')) return '/pro'
  return trimmed
}

function redirectToLogin(router: ReturnType<typeof useRouter>, reason?: string) {
  const from = sanitizeFrom(currentPathWithQuery())
  const qs = new URLSearchParams({ from })
  if (reason) qs.set('reason', reason)
  router.push(`/login?${qs.toString()}`)
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function errorFromResponse(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (typeof data?.message === 'string') return data.message
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function clampInt(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function isRebookMode(x: unknown): x is RebookMode {
  return x === 'NONE' || x === 'BOOKED_NEXT_APPOINTMENT' || x === 'RECOMMENDED_WINDOW'
}

function pickString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function isValidHttpUrl(url: string) {
  const s = url.trim()
  if (!s) return false
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function safeId() {
  try {
    // @ts-ignore
    return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  } catch {
    return `${Date.now()}-${Math.random()}`
  }
}

/**
 * ISO (UTC instant) -> datetime-local string in a given IANA timezone.
 * Output: "YYYY-MM-DDTHH:MM"
 */
function isoToDatetimeLocalInTimeZone(iso: string | null, timeZone: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''

  const tz = sanitizeTimeZone(timeZone, 'UTC') || 'UTC'
  const p = getZonedParts(d, tz)

  const yyyy = String(p.year).padStart(4, '0')
  const mm = String(p.month).padStart(2, '0')
  const dd = String(p.day).padStart(2, '0')
  const hh = String(p.hour).padStart(2, '0')
  const mi = String(p.minute).padStart(2, '0')

  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
}

/**
 * datetime-local string (interpreted in IANA timezone) -> ISO (UTC instant).
 * Input: "YYYY-MM-DDTHH:MM"
 */
function isoFromDatetimeLocalInTimeZone(value: string, timeZone: string): string | null {
  const v = (value || '').trim()
  if (!v) return null

  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v)
  if (!m) return null

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])

  if (![year, month, day, hour, minute].every(Number.isFinite)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (hour < 0 || hour > 23) return null
  if (minute < 0 || minute > 59) return null

  const tz = sanitizeTimeZone(timeZone, 'UTC') || 'UTC'
  const utc = zonedTimeToUtc({ year, month, day, hour, minute, second: 0, timeZone: tz })
  if (Number.isNaN(utc.getTime())) return null
  return utc.toISOString()
}

function cardClass() {
  return 'rounded-card border border-white/10 bg-bgSecondary p-4 text-textPrimary'
}
function subtleTextClass() {
  return 'text-xs font-semibold text-textSecondary'
}
function sectionTitleClass() {
  return 'text-xs font-black tracking-wide text-textPrimary'
}
function pillClass(active: boolean) {
  return [
    'inline-flex items-center rounded-full px-3 py-1 text-xs font-black transition',
    'border border-white/10',
    active ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
  ].join(' ')
}
function primaryBtn(disabled: boolean) {
  return [
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-black transition',
    disabled
      ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary opacity-60'
      : 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
  ].join(' ')
}
function secondaryBtn(disabled: boolean) {
  return [
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-black transition',
    disabled
      ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary opacity-60'
      : 'border border-white/10 bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
  ].join(' ')
}
function inputClass(disabled: boolean) {
  return [
    'w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm text-textPrimary outline-none',
    disabled ? 'opacity-60 cursor-not-allowed' : 'focus:border-white/20',
  ].join(' ')
}
function labelClass() {
  return 'block text-xs font-black text-textSecondary mb-1'
}

export default function AftercareForm({
  bookingId,
  timeZone,
  existingNotes,
  existingRebookedFor,
  existingRebookMode,
  existingRebookWindowStart,
  existingRebookWindowEnd,
  existingMedia,
  existingRecommendedProducts,
}: Props) {
  const router = useRouter()

  const tz = useMemo(() => sanitizeTimeZone(timeZone, 'UTC') || 'UTC', [timeZone])

  const [notes, setNotes] = useState((existingNotes || '').slice(0, NOTES_MAX))

  const [products, setProducts] = useState<RecommendedProduct[]>([])
  const [productsError, setProductsError] = useState<string | null>(null)

  const [rebookMode, setRebookMode] = useState<RebookMode>('NONE')
  const [rebookAt, setRebookAt] = useState<string>('') // datetime-local in tz
  const [windowStart, setWindowStart] = useState<string>('') // datetime-local in tz
  const [windowEnd, setWindowEnd] = useState<string>('') // datetime-local in tz

  const [createRebookReminder, setCreateRebookReminder] = useState(false)
  const [rebookDaysBefore, setRebookDaysBefore] = useState('2')

  const [createProductReminder, setCreateProductReminder] = useState(false)
  const [productDaysAfter, setProductDaysAfter] = useState('7')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // separate “saved” vs “sent”
  const [saved, setSaved] = useState(false)
  const [sent, setSent] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const modeFromProps = existingRebookMode && isRebookMode(existingRebookMode) ? existingRebookMode : null

    const inferred: RebookMode =
      modeFromProps ??
      (existingRebookWindowStart || existingRebookWindowEnd
        ? 'RECOMMENDED_WINDOW'
        : existingRebookedFor
          ? 'BOOKED_NEXT_APPOINTMENT'
          : 'NONE')

    setRebookMode(inferred)

    setRebookAt(existingRebookedFor ? isoToDatetimeLocalInTimeZone(existingRebookedFor, tz) : '')
    setWindowStart(existingRebookWindowStart ? isoToDatetimeLocalInTimeZone(existingRebookWindowStart, tz) : '')
    setWindowEnd(existingRebookWindowEnd ? isoToDatetimeLocalInTimeZone(existingRebookWindowEnd, tz) : '')

    // If a booked date exists, default reminder ON
    setCreateRebookReminder(Boolean(existingRebookedFor))

    setProducts(
      (existingRecommendedProducts || []).slice(0, MAX_PRODUCTS).map((p) => ({
        id: p.id || safeId(),
        name: p.name || '',
        url: p.url || '',
        note: p.note || '',
      })),
    )
  }, [existingRebookMode, existingRebookedFor, existingRebookWindowStart, existingRebookWindowEnd, existingRecommendedProducts, tz])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  function markDirty() {
    if (saved) setSaved(false)
    if (sent) setSent(false)
  }

  const sortedMedia = useMemo(() => {
    return [...(existingMedia || [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [existingMedia])

  const beforeMedia = useMemo(() => sortedMedia.filter((m) => m.phase === 'BEFORE'), [sortedMedia])
  const afterMedia = useMemo(() => sortedMedia.filter((m) => m.phase === 'AFTER'), [sortedMedia])
  const otherMedia = useMemo(() => sortedMedia.filter((m) => m.phase !== 'BEFORE' && m.phase !== 'AFTER'), [sortedMedia])

  const hasBookedDate = Boolean(rebookAt.trim())
  const hasWindowStart = Boolean(windowStart.trim())
  const hasWindowEnd = Boolean(windowEnd.trim())

  const windowError =
    rebookMode === 'RECOMMENDED_WINDOW' && (hasWindowStart || hasWindowEnd)
      ? (() => {
          const startISO = isoFromDatetimeLocalInTimeZone(windowStart, tz)
          const endISO = isoFromDatetimeLocalInTimeZone(windowEnd, tz)
          if (!startISO || !endISO) return 'Pick both a window start and end.'
          const a = new Date(startISO)
          const b = new Date(endISO)
          if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 'Window dates are invalid.'
          if (b <= a) return 'Window end must be after window start.'
          return null
        })()
      : null

  // Rebook reminder only valid for single date mode
  useEffect(() => {
    if (rebookMode !== 'BOOKED_NEXT_APPOINTMENT' && createRebookReminder) setCreateRebookReminder(false)
  }, [rebookMode, createRebookReminder])

  useEffect(() => {
    if (rebookMode === 'BOOKED_NEXT_APPOINTMENT' && !hasBookedDate && createRebookReminder) setCreateRebookReminder(false)
  }, [rebookMode, hasBookedDate, createRebookReminder])

  function onChangeMode(next: RebookMode) {
    setError(null)
    setProductsError(null)
    setRebookMode(next)
    markDirty()

    if (next === 'NONE') {
      setRebookAt('')
      setWindowStart('')
      setWindowEnd('')
      setCreateRebookReminder(false)
      return
    }

    if (next === 'BOOKED_NEXT_APPOINTMENT') {
      setWindowStart('')
      setWindowEnd('')
      return
    }

    if (next === 'RECOMMENDED_WINDOW') {
      setRebookAt('')
      setCreateRebookReminder(false)
      return
    }
  }

  function addProduct() {
    if (products.length >= MAX_PRODUCTS) return
    setProductsError(null)
    markDirty()
    setProducts((p) => [...p, { id: safeId(), name: '', url: '', note: '' }])
  }

  function updateProduct(id: string, patch: Partial<RecommendedProduct>) {
    setProductsError(null)
    markDirty()
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  function removeProduct(id: string) {
    setProductsError(null)
    markDirty()
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }

  function validateProducts(list: RecommendedProduct[]) {
    for (const p of list) {
      const name = p.name.trim()
      const url = p.url.trim()
      const note = pickString(p.note).trim()

      // Empty row is allowed
      if (!name && !url && !note) continue

      if (!name) return 'Each product needs a name.'
      if (name.length > PRODUCT_NAME_MAX) return `Product name is too long (max ${PRODUCT_NAME_MAX}).`
      if (!url) return 'Each product needs a link.'
      if (!isValidHttpUrl(url)) return 'Product links must be valid http/https URLs.'
      if (note.length > PRODUCT_NOTE_MAX) return `Product note is too long (max ${PRODUCT_NOTE_MAX}).`
    }
    return null
  }

  function buildPayload(sendToClient: boolean) {
    const rebookISO = isoFromDatetimeLocalInTimeZone(rebookAt, tz)
    const windowStartISO = isoFromDatetimeLocalInTimeZone(windowStart, tz)
    const windowEndISO = isoFromDatetimeLocalInTimeZone(windowEnd, tz)

    const daysBeforeRaw = parseInt(rebookDaysBefore, 10)
    const daysAfterRaw = parseInt(productDaysAfter, 10)

    const sanitizedProducts = products
      .map((p) => ({
        id: p.id,
        name: p.name.trim().slice(0, PRODUCT_NAME_MAX),
        url: p.url.trim(),
        note: pickString(p.note).trim().slice(0, PRODUCT_NOTE_MAX) || null,
      }))
      .filter((p) => p.name || p.url || p.note)

    return {
      notes: notes.trim().slice(0, NOTES_MAX) || '',
      recommendedProducts: sanitizedProducts,

      rebookMode,
      rebookedFor: rebookMode === 'BOOKED_NEXT_APPOINTMENT' ? rebookISO : null,
      rebookWindowStart: rebookMode === 'RECOMMENDED_WINDOW' ? windowStartISO : null,
      rebookWindowEnd: rebookMode === 'RECOMMENDED_WINDOW' ? windowEndISO : null,

      createRebookReminder: rebookMode === 'BOOKED_NEXT_APPOINTMENT' && !!rebookISO ? createRebookReminder : false,
      rebookReminderDaysBefore: clampInt(daysBeforeRaw, 1, 30, 2),

      createProductReminder,
      productReminderDaysAfter: clampInt(daysAfterRaw, 1, 180, 7),

      sendToClient,
      timeZone: tz,
    }
  }

  function validateBeforePost(sendToClient: boolean) {
    if (!bookingId) return 'Missing booking id.'

    const rebookISO = isoFromDatetimeLocalInTimeZone(rebookAt, tz)
    const windowStartISO = isoFromDatetimeLocalInTimeZone(windowStart, tz)
    const windowEndISO = isoFromDatetimeLocalInTimeZone(windowEnd, tz)

    if (rebookMode === 'BOOKED_NEXT_APPOINTMENT' && !rebookISO) {
      return 'Pick a recommended next visit date, or change rebook mode to “None”.'
    }

    if (rebookMode === 'RECOMMENDED_WINDOW') {
      if (!windowStartISO || !windowEndISO) return 'Pick both a start and end for the recommended booking window.'
      if (new Date(windowEndISO) <= new Date(windowStartISO)) return 'Window end must be after window start.'
    }

    const prodErr = validateProducts(products)
    if (prodErr) {
      setProductsError(prodErr)
      return 'Fix product links/names before continuing.'
    }

    if (sendToClient) {
      const hasNotes = Boolean(notes.trim())
      const hasAfter = afterMedia.length > 0
      const hasAnyProduct = products.some((p) => p.name.trim() || p.url.trim() || pickString(p.note).trim())

      if (!hasNotes && !hasAfter && !hasAnyProduct) {
        return 'Add notes, after photos, or at least one product before sending to the client.'
      }
    }

    return null
  }

  function dispatchForceRefresh() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new Event(FORCE_EVENT))
  }

  async function postAftercare(sendToClient: boolean) {
    setError(null)
    setProductsError(null)

    const validationError = validateBeforePost(sendToClient)
    if (validationError) {
      setError(validationError)
      return
    }

    if (loading) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)

    try {
      const payload = buildPayload(sendToClient)

      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/aftercare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (res.status === 401) {
        redirectToLogin(router, 'aftercare')
        return
      }

      const data = await safeJson(res)
      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      const clientNotified = Boolean(data?.clientNotified)
      const bookingFinished = Boolean(data?.bookingFinished)
      const redirectTo = typeof data?.redirectTo === 'string' ? data.redirectTo : null

      if (clientNotified) {
        setSent(true)
        setSaved(false)
      } else {
        setSaved(true)
        setSent(false)
      }

      router.refresh()
      dispatchForceRefresh()

      if (sendToClient && bookingFinished && redirectTo) {
        router.replace(redirectTo)
        return
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error(err)
      setError('Network error posting aftercare.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setLoading(false)
    }
  }

  function goCalendar() {
    router.push('/pro/calendar')
  }

  function goDashboard() {
    router.push('/pro')
  }

  const showBooked = rebookMode === 'BOOKED_NEXT_APPOINTMENT'
  const showWindow = rebookMode === 'RECOMMENDED_WINDOW'
  const disabled = loading

  return (
    <div className="grid gap-3">
      <div className="rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="text-xs font-black text-accentPrimary">Client-facing</div>
        <div className="mt-1 text-sm font-semibold text-textSecondary">
          This is the client’s official appointment summary. You can save drafts and only send when it’s ready.
        </div>
      </div>

      {sent ? (
        <div className="rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="text-sm font-black text-textPrimary">Sent to client ✅</div>
          <div className="mt-1 text-sm font-semibold text-textSecondary">They can view it now and rebook immediately.</div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={goCalendar} className={primaryBtn(false)}>
              Back to calendar
            </button>
            <button type="button" onClick={goDashboard} className={secondaryBtn(false)}>
              Dashboard overview
            </button>
          </div>
        </div>
      ) : saved ? (
        <div className="rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="text-sm font-black text-textPrimary">Draft saved ✅</div>
          <div className="mt-1 text-sm font-semibold text-textSecondary">
            Not sent to the client yet. Hit “Send to client” when you’re ready.
          </div>
        </div>
      ) : null}

      {/* Photos */}
      <div className={cardClass()}>
        <div className={sectionTitleClass()}>Photos</div>
        <div className={subtleTextClass()}>Visible to you + the client (PRO_CLIENT). Not public.</div>

        <div className="mt-3 grid gap-4">
          <div>
            <div className="text-sm font-black text-textPrimary">Before</div>
            <div className={subtleTextClass()}>Before photos/videos from this appointment.</div>
            <MediaGrid items={beforeMedia} />
          </div>

          <div>
            <div className="text-sm font-black text-textPrimary">After</div>
            <div className={subtleTextClass()}>After photos/videos from this appointment.</div>
            <MediaGrid items={afterMedia} />
          </div>

          {otherMedia.length ? (
            <div>
              <div className="text-sm font-black text-textPrimary">Other</div>
              <div className={subtleTextClass()}>Extra photos/videos attached to this appointment.</div>
              <MediaGrid items={otherMedia} />
            </div>
          ) : null}
        </div>
      </div>

      {/* Products */}
      <div className={cardClass()}>
        <div className={sectionTitleClass()}>Recommended products</div>
        <div className={subtleTextClass()}>
          Add products with links (Amazon storefront, pro shop, etc.). Links must be http/https.
        </div>

        <div className="mt-3 grid gap-3">
          {products.length === 0 ? (
            <div className="text-sm font-semibold text-textSecondary">No products added yet.</div>
          ) : (
            products.map((p, idx) => (
              <div key={p.id} className="rounded-card border border-white/10 bg-bgPrimary p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-black text-textPrimary">Product {idx + 1}</div>
                  <button type="button" onClick={() => removeProduct(p.id)} disabled={disabled} className={secondaryBtn(Boolean(disabled))}>
                    Remove
                  </button>
                </div>

                <div className="mt-3 grid gap-3">
                  <div>
                    <label className={labelClass()}>Product name</label>
                    <input
                      value={p.name}
                      disabled={disabled}
                      maxLength={PRODUCT_NAME_MAX}
                      onChange={(e) => updateProduct(p.id, { name: e.target.value })}
                      placeholder="e.g. Sulfate-free shampoo"
                      className={inputClass(Boolean(disabled))}
                    />
                  </div>

                  <div>
                    <label className={labelClass()}>Product link</label>
                    <input
                      value={p.url}
                      disabled={disabled}
                      onChange={(e) => updateProduct(p.id, { url: e.target.value })}
                      placeholder="https://amazon.com/…"
                      className={inputClass(Boolean(disabled))}
                    />
                    {p.url.trim() && !isValidHttpUrl(p.url) ? (
                      <div className="mt-1 text-xs font-semibold text-microAccent">Link must be a valid http/https URL.</div>
                    ) : null}
                  </div>

                  <div>
                    <label className={labelClass()}>Note (optional)</label>
                    <input
                      value={pickString(p.note)}
                      disabled={disabled}
                      maxLength={PRODUCT_NOTE_MAX}
                      onChange={(e) => updateProduct(p.id, { note: e.target.value })}
                      placeholder="e.g. Use 2–3x/week to maintain shine"
                      className={inputClass(Boolean(disabled))}
                    />
                  </div>
                </div>
              </div>
            ))
          )}

          <button
            type="button"
            onClick={addProduct}
            disabled={disabled || products.length >= MAX_PRODUCTS}
            className={secondaryBtn(Boolean(disabled || products.length >= MAX_PRODUCTS))}
          >
            + Add product
          </button>

          {productsError ? <div className="text-sm font-semibold text-microAccent">{productsError}</div> : null}
        </div>
      </div>

      {/* Instructions + controls */}
      <div className={cardClass()}>
        <div className={sectionTitleClass()}>Aftercare instructions</div>
        <div className={subtleTextClass()}>Write this like doctor instructions: clear, specific, and actionable.</div>

        <div className="mt-3">
          <label className={labelClass()} htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value.slice(0, NOTES_MAX))
              markDirty()
            }}
            rows={5}
            disabled={disabled}
            placeholder="E.g. wash after 48 hours, use sulfate-free shampoo, avoid tight ponytails for 7 days…"
            className={[
              'w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm text-textPrimary outline-none resize-y',
              disabled ? 'opacity-60 cursor-not-allowed' : 'focus:border-white/20',
            ].join(' ')}
          />
          <div className="mt-1 text-xs font-semibold text-textSecondary">
            {notes.length}/{NOTES_MAX}
          </div>
        </div>

        {/* Rebook */}
        <div className="mt-4 rounded-card border border-white/10 bg-bgPrimary p-3">
          <div className="text-sm font-black text-textPrimary">Rebook guidance</div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => onChangeMode('NONE')} disabled={disabled} className={pillClass(rebookMode === 'NONE')}>
              None
            </button>

            <button
              type="button"
              onClick={() => onChangeMode('BOOKED_NEXT_APPOINTMENT')}
              disabled={disabled}
              className={pillClass(rebookMode === 'BOOKED_NEXT_APPOINTMENT')}
              title="Recommend a single ideal next visit date"
            >
              Next visit date
            </button>

            <button
              type="button"
              onClick={() => onChangeMode('RECOMMENDED_WINDOW')}
              disabled={disabled}
              className={pillClass(rebookMode === 'RECOMMENDED_WINDOW')}
              title="Recommend a date range the client should book within"
            >
              Booking window
            </button>
          </div>

          {showBooked ? (
            <div className="mt-4">
              <label className={labelClass()} htmlFor="rebookAt">
                Recommended next visit
              </label>
              <input
                id="rebookAt"
                type="datetime-local"
                value={rebookAt}
                disabled={disabled}
                onChange={(e) => {
                  setRebookAt(e.target.value)
                  markDirty()
                }}
                className={inputClass(Boolean(disabled))}
              />
              <div className="mt-1 text-xs font-semibold text-textSecondary">This shows on the client’s summary and can power a reminder.</div>
              <div className="mt-1 text-[11px] font-semibold text-textSecondary">
                Timezone: <span className="text-textPrimary">{tz}</span>
              </div>
            </div>
          ) : null}

          {showWindow ? (
            <div className="mt-4 grid gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass()}>Window start</label>
                  <input
                    type="datetime-local"
                    value={windowStart}
                    disabled={disabled}
                    onChange={(e) => {
                      setWindowStart(e.target.value)
                      markDirty()
                    }}
                    className={inputClass(Boolean(disabled))}
                  />
                </div>

                <div>
                  <label className={labelClass()}>Window end</label>
                  <input
                    type="datetime-local"
                    value={windowEnd}
                    disabled={disabled}
                    onChange={(e) => {
                      setWindowEnd(e.target.value)
                      markDirty()
                    }}
                    className={inputClass(Boolean(disabled))}
                  />
                </div>
              </div>

              {windowError ? (
                <div className="text-sm font-semibold text-microAccent">{windowError}</div>
              ) : (
                <div className="text-xs font-semibold text-textSecondary">
                  Client will be prompted to book within this range. Timezone: <span className="text-textPrimary">{tz}</span>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Smart reminders */}
        <div className="mt-4 rounded-card border border-white/10 bg-bgPrimary p-3">
          <div className="text-sm font-black text-textPrimary">Smart reminders</div>

          <label
            className={[
              'mt-3 flex items-center gap-2 text-sm font-semibold',
              rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate ? 'text-textPrimary' : 'text-textSecondary opacity-60',
            ].join(' ')}
            title={
              rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate
                ? undefined
                : 'Rebook reminders only apply to a single recommended date (not window mode).'
            }
          >
            <input
              type="checkbox"
              checked={createRebookReminder}
              disabled={!(rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate) || disabled}
              onChange={(e) => {
                setCreateRebookReminder(e.target.checked)
                markDirty()
              }}
            />
            <span>
              Create a rebook reminder{' '}
              <select
                value={rebookDaysBefore}
                disabled={!(rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate) || disabled}
                onChange={(e) => {
                  setRebookDaysBefore(e.target.value)
                  markDirty()
                }}
                className={[
                  'mx-1 rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-xs font-black text-textPrimary',
                  !(rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate) || disabled ? 'opacity-60 cursor-not-allowed' : '',
                ].join(' ')}
              >
                <option value="1">1 day</option>
                <option value="2">2 days</option>
                <option value="3">3 days</option>
                <option value="7">7 days</option>
              </select>
              before the recommended date.
            </span>
          </label>

          <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-textPrimary">
            <input
              type="checkbox"
              checked={createProductReminder}
              disabled={disabled}
              onChange={(e) => {
                setCreateProductReminder(e.target.checked)
                markDirty()
              }}
            />
            <span>
              Create a product follow-up{' '}
              <select
                value={productDaysAfter}
                disabled={disabled}
                onChange={(e) => {
                  setProductDaysAfter(e.target.value)
                  markDirty()
                }}
                className={[
                  'mx-1 rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-xs font-black text-textPrimary',
                  disabled ? 'opacity-60 cursor-not-allowed' : '',
                ].join(' ')}
              >
                <option value="3">3 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
              </select>
              after the appointment.
            </span>
          </label>

          <div className="mt-2 text-xs font-semibold text-textSecondary">These go into your Reminders tab so Future You remembers to check in.</div>
        </div>

        {error ? <div className="mt-3 text-sm font-semibold text-microAccent">{error}</div> : null}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button type="button" disabled={disabled || !!windowError} onClick={() => postAftercare(false)} className={secondaryBtn(Boolean(disabled || !!windowError))}>
            {loading ? 'Saving…' : 'Save draft'}
          </button>

          <button type="button" disabled={disabled || !!windowError} onClick={() => postAftercare(true)} className={primaryBtn(Boolean(disabled || !!windowError))}>
            {loading ? 'Sending…' : 'Send to client'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MediaGrid({ items }: { items: MediaItem[] }) {
  if (!items || items.length === 0) {
    return <div className="mt-2 text-sm font-semibold text-textSecondary">None yet.</div>
  }

  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {items.map((m) => {
        const href = m.renderUrl ?? null
        const thumb = m.renderThumbUrl ?? m.renderUrl ?? null

        const isVideo = m.mediaType === 'VIDEO'
        const isProClient = m.visibility === 'PRO_CLIENT'

        return (
          <div
            key={m.id}
            className={[
              'relative block aspect-square overflow-hidden rounded-card bg-bgPrimary transition',
              isProClient ? 'border border-white/10' : 'border border-transparent',
              'hover:bg-surfaceGlass',
            ].join(' ')}
            title={isProClient ? 'Visible to pro + client' : 'Public'}
          >
            {thumb ? (
              href ? (
                <a href={href} target="_blank" rel="noreferrer" className="block h-full w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumb} alt="Booking media" className="h-full w-full object-cover" />
                </a>
              ) : (
                <div className="h-full w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumb} alt="Booking media" className="h-full w-full object-cover" />
                </div>
              )
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-textSecondary">
                Unavailable
              </div>
            )}

            {isVideo ? (
              <div className="absolute right-2 top-2 rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-[10px] font-black text-textPrimary">
                VIDEO
              </div>
            ) : null}

            <div className="absolute bottom-2 left-2 rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-[10px] font-black text-textPrimary">
              {isProClient ? 'PRO + CLIENT' : 'PUBLIC'}
            </div>
          </div>
        )
      })}
    </div>
  )
}