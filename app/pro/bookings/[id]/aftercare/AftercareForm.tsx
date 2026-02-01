// app/pro/bookings/[id]/aftercare/AftercareForm.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getZonedParts, sanitizeTimeZone, zonedTimeToUtc } from '@/lib/timeZone'

type MediaType = 'IMAGE' | 'VIDEO'
type MediaVisibility = 'PUBLIC' | 'PRIVATE'
type Role = 'CLIENT' | 'PRO' | 'ADMIN'
type MediaPhase = 'BEFORE' | 'AFTER' | 'OTHER'

type MediaItem = {
  id: string
  url: string
  thumbUrl: string | null
  mediaType: MediaType
  visibility: MediaVisibility
  uploadedByRole: Role | null
  reviewId: string | null
  createdAt: string
  phase: MediaPhase
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

  /**
   * IANA timezone that governs meaning of datetime-local fields.
   * This should come from booking/location/pro settings, NOT the browser.
   */
  timeZone: string

  existingNotes: string

  existingRebookedFor: string | null
  existingRebookMode?: RebookMode | null
  existingRebookWindowStart?: string | null
  existingRebookWindowEnd?: string | null

  existingMedia: MediaItem[]

  existingRecommendedProducts?: RecommendedProduct[]
}

const MAX_PRODUCTS = 10
const PRODUCT_NAME_MAX = 80
const PRODUCT_NOTE_MAX = 140
const NOTES_MAX = 4000

function isDeletedByClient(media: MediaItem) {
  return media.uploadedByRole === 'CLIENT' && media.reviewId === null && media.visibility === 'PRIVATE'
}

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
  // crypto.randomUUID exists in modern browsers; fallback keeps it safe in odd environments.
  try {
    // @ts-ignore
    return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  } catch {
    return `${Date.now()}-${Math.random()}`
  }
}

/**
 * Convert ISO (UTC instant) -> datetime-local string in a given IANA timezone.
 * Output format: "YYYY-MM-DDTHH:MM"
 */
function isoToDatetimeLocalInTimeZone(iso: string | null, timeZone: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''

  // ✅ no LA fallback: UTC is our safe default
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
 * Convert datetime-local string (interpreted in IANA timezone) -> ISO (UTC instant).
 * Input format expected: "YYYY-MM-DDTHH:MM"
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

  // ✅ no LA fallback
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

  // ✅ never LA fallback; UTC fallback only
  const tz = useMemo(() => sanitizeTimeZone(timeZone, 'UTC') || 'UTC', [timeZone])

  const [notes, setNotes] = useState((existingNotes || '').slice(0, NOTES_MAX))

  const [products, setProducts] = useState<RecommendedProduct[]>([])
  const [productsError, setProductsError] = useState<string | null>(null)

  const [rebookMode, setRebookMode] = useState<RebookMode>('NONE')
  const [rebookAt, setRebookAt] = useState<string>('') // datetime-local (in tz)
  const [windowStart, setWindowStart] = useState<string>('') // datetime-local (in tz)
  const [windowEnd, setWindowEnd] = useState<string>('') // datetime-local (in tz)

  const [createRebookReminder, setCreateRebookReminder] = useState(false)
  const [rebookDaysBefore, setRebookDaysBefore] = useState('2')

  const [createProductReminder, setCreateProductReminder] = useState(false)
  const [productDaysAfter, setProductDaysAfter] = useState('7')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [completed, setCompleted] = useState(false)

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

    if (existingRebookedFor) setRebookAt(isoToDatetimeLocalInTimeZone(existingRebookedFor, tz))
    if (existingRebookWindowStart) setWindowStart(isoToDatetimeLocalInTimeZone(existingRebookWindowStart, tz))
    if (existingRebookWindowEnd) setWindowEnd(isoToDatetimeLocalInTimeZone(existingRebookWindowEnd, tz))

    if (existingRebookedFor) setCreateRebookReminder(true)

    setProducts(
      (existingRecommendedProducts || []).slice(0, MAX_PRODUCTS).map((p) => ({
        id: p.id || safeId(),
        name: p.name || '',
        url: p.url || '',
        note: p.note || '',
      })),
    )
  }, [
    existingRebookMode,
    existingRebookedFor,
    existingRebookWindowStart,
    existingRebookWindowEnd,
    existingRecommendedProducts,
    tz,
  ])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const sortedMedia = useMemo(() => {
    return [...(existingMedia || [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [existingMedia])

  const beforeMedia = useMemo(() => sortedMedia.filter((m) => m.phase === 'BEFORE'), [sortedMedia])
  const afterMedia = useMemo(() => sortedMedia.filter((m) => m.phase === 'AFTER'), [sortedMedia])
  const otherMedia = useMemo(() => sortedMedia.filter((m) => m.phase !== 'BEFORE' && m.phase !== 'AFTER'), [sortedMedia])

  const hasBookedDate = Boolean(rebookAt)
  const hasWindowStart = Boolean(windowStart)
  const hasWindowEnd = Boolean(windowEnd)

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

  // Guard: rebook reminders only apply to single date mode
  useEffect(() => {
    if (rebookMode !== 'BOOKED_NEXT_APPOINTMENT' && createRebookReminder) setCreateRebookReminder(false)
  }, [rebookMode, createRebookReminder])

  useEffect(() => {
    if (rebookMode === 'BOOKED_NEXT_APPOINTMENT' && !hasBookedDate && createRebookReminder) setCreateRebookReminder(false)
  }, [rebookMode, hasBookedDate, createRebookReminder])

  function onChangeMode(next: RebookMode) {
    setRebookMode(next)
    setError(null)

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
    setProducts((p) => [...p, { id: safeId(), name: '', url: '', note: '' }])
  }

  function updateProduct(id: string, patch: Partial<RecommendedProduct>) {
    setProductsError(null)
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  function removeProduct(id: string) {
    setProductsError(null)
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }

  function validateProducts(list: RecommendedProduct[]) {
    for (const p of list) {
      const name = p.name.trim()
      const url = p.url.trim()
      const note = pickString(p.note).trim()

      if (!name && !url && !note) continue

      if (!name) return 'Each product needs a name.'
      if (name.length > PRODUCT_NAME_MAX) return `Product name is too long (max ${PRODUCT_NAME_MAX}).`
      if (!url) return 'Each product needs a link.'
      if (!isValidHttpUrl(url)) return 'Product links must be valid http/https URLs.'
      if (note.length > PRODUCT_NOTE_MAX) return `Product note is too long (max ${PRODUCT_NOTE_MAX}).`
    }
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setProductsError(null)

    if (!bookingId) {
      setError('Missing booking id.')
      return
    }
    if (loading) return

    const rebookISO = isoFromDatetimeLocalInTimeZone(rebookAt, tz)
    const windowStartISO = isoFromDatetimeLocalInTimeZone(windowStart, tz)
    const windowEndISO = isoFromDatetimeLocalInTimeZone(windowEnd, tz)

    if (rebookMode === 'BOOKED_NEXT_APPOINTMENT' && !rebookISO) {
      setError('Pick a recommended next visit date, or change rebook mode to “None”.')
      return
    }

    if (rebookMode === 'RECOMMENDED_WINDOW') {
      if (!windowStartISO || !windowEndISO) {
        setError('Pick both a start and end for the recommended booking window.')
        return
      }
      if (new Date(windowEndISO) <= new Date(windowStartISO)) {
        setError('Window end must be after window start.')
        return
      }
    }

    const prodErr = validateProducts(products)
    if (prodErr) {
      setProductsError(prodErr)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)

    try {
      const daysBeforeRaw = parseInt(rebookDaysBefore, 10)
      const daysAfterRaw = parseInt(productDaysAfter, 10)

      const sanitizedProducts = products
        .map((p) => ({
          id: p.id,
          name: p.name.trim(),
          url: p.url.trim(),
          note: pickString(p.note).trim() || null,
        }))
        .filter((p) => p.name || p.url || p.note)

      const payload = {
        notes: notes.trim().slice(0, NOTES_MAX) || '',
        recommendedProducts: sanitizedProducts,

        rebookMode,
        rebookedFor: rebookMode === 'BOOKED_NEXT_APPOINTMENT' ? rebookISO : null,
        rebookWindowStart: rebookMode === 'RECOMMENDED_WINDOW' ? windowStartISO : null,
        rebookWindowEnd: rebookMode === 'RECOMMENDED_WINDOW' ? windowEndISO : null,

        createRebookReminder: rebookMode === 'BOOKED_NEXT_APPOINTMENT' && rebookISO ? createRebookReminder : false,
        rebookReminderDaysBefore: clampInt(daysBeforeRaw, 1, 30, 2),

        createProductReminder,
        productReminderDaysAfter: clampInt(daysAfterRaw, 1, 180, 7),

        // optional but useful for server-side validation/debugging
        timeZone: tz,
      }

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

      setCompleted(true)
      router.refresh()
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error(err)
      setError('Network error sending aftercare.')
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

  return (
    <div className="grid gap-3">
      {/* Visibility warning */}
      <div className="rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="text-xs font-black text-accentPrimary">Visible to client</div>
        <div className="mt-1 text-sm font-semibold text-textSecondary">
          Everything on this page shows up as the client’s official appointment summary.
        </div>
      </div>

      {completed ? (
        <div className="rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="text-sm font-black text-textPrimary">Aftercare sent</div>
          <div className="mt-1 text-sm font-semibold text-textSecondary">
            The client can view their summary and rebook guidance.
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={goCalendar} className={primaryBtn(false)}>
              Back to calendar
            </button>
            <button type="button" onClick={goDashboard} className={secondaryBtn(false)}>
              Dashboard overview
            </button>
          </div>
        </div>
      ) : null}

      {/* Photos */}
      <div className={cardClass()}>
        <div className={sectionTitleClass()}>Photos</div>
        <div className={subtleTextClass()}>These appear in the client’s appointment summary.</div>

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
                  <button
                    type="button"
                    onClick={() => removeProduct(p.id)}
                    disabled={loading || completed}
                    className={secondaryBtn(Boolean(loading || completed))}
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-3 grid gap-3">
                  <div>
                    <label className={labelClass()}>Product name</label>
                    <input
                      value={p.name}
                      disabled={loading || completed}
                      maxLength={PRODUCT_NAME_MAX}
                      onChange={(e) => updateProduct(p.id, { name: e.target.value })}
                      placeholder="e.g. Sulfate-free shampoo"
                      className={inputClass(Boolean(loading || completed))}
                    />
                  </div>

                  <div>
                    <label className={labelClass()}>Product link</label>
                    <input
                      value={p.url}
                      disabled={loading || completed}
                      onChange={(e) => updateProduct(p.id, { url: e.target.value })}
                      placeholder="https://amazon.com/…"
                      className={inputClass(Boolean(loading || completed))}
                    />
                    {p.url.trim() && !isValidHttpUrl(p.url) ? (
                      <div className="mt-1 text-xs font-semibold text-microAccent">
                        Link must be a valid http/https URL.
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <label className={labelClass()}>Note (optional)</label>
                    <input
                      value={pickString(p.note)}
                      disabled={loading || completed}
                      maxLength={PRODUCT_NOTE_MAX}
                      onChange={(e) => updateProduct(p.id, { note: e.target.value })}
                      placeholder="e.g. Use 2–3x/week to maintain shine"
                      className={inputClass(Boolean(loading || completed))}
                    />
                  </div>
                </div>
              </div>
            ))
          )}

          <button
            type="button"
            onClick={addProduct}
            disabled={loading || completed || products.length >= MAX_PRODUCTS}
            className={secondaryBtn(Boolean(loading || completed || products.length >= MAX_PRODUCTS))}
          >
            + Add product
          </button>

          {productsError ? <div className="text-sm font-semibold text-microAccent">{productsError}</div> : null}
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className={cardClass()}>
        <div className={sectionTitleClass()}>Aftercare instructions</div>
        <div className={subtleTextClass()}>Write this like doctor instructions: clear, specific, and actionable.</div>

        <div className="mt-3">
          <label className={labelClass()} htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
            rows={5}
            disabled={loading || completed}
            placeholder="E.g. wash after 48 hours, use sulfate-free shampoo, avoid tight ponytails for 7 days…"
            className={[
              'w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm text-textPrimary outline-none resize-y',
              loading || completed ? 'opacity-60 cursor-not-allowed' : 'focus:border-white/20',
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
            <button
              type="button"
              onClick={() => onChangeMode('NONE')}
              disabled={loading || completed}
              className={pillClass(rebookMode === 'NONE')}
            >
              None
            </button>

            <button
              type="button"
              onClick={() => onChangeMode('BOOKED_NEXT_APPOINTMENT')}
              disabled={loading || completed}
              className={pillClass(rebookMode === 'BOOKED_NEXT_APPOINTMENT')}
              title="Recommend a single ideal next visit date"
            >
              Next visit date
            </button>

            <button
              type="button"
              onClick={() => onChangeMode('RECOMMENDED_WINDOW')}
              disabled={loading || completed}
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
                disabled={loading || completed}
                onChange={(e) => setRebookAt(e.target.value)}
                className={inputClass(Boolean(loading || completed))}
              />
              <div className="mt-1 text-xs font-semibold text-textSecondary">
                This shows on the client’s summary and can power a reminder.
              </div>
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
                    disabled={loading || completed}
                    onChange={(e) => setWindowStart(e.target.value)}
                    className={inputClass(Boolean(loading || completed))}
                  />
                </div>

                <div>
                  <label className={labelClass()}>Window end</label>
                  <input
                    type="datetime-local"
                    value={windowEnd}
                    disabled={loading || completed}
                    onChange={(e) => setWindowEnd(e.target.value)}
                    className={inputClass(Boolean(loading || completed))}
                  />
                </div>
              </div>

              {windowError ? (
                <div className="text-sm font-semibold text-microAccent">{windowError}</div>
              ) : (
                <div className="text-xs font-semibold text-textSecondary">
                  Client will be prompted to book within this range. Timezone:{' '}
                  <span className="text-textPrimary">{tz}</span>
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
              rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate
                ? 'text-textPrimary'
                : 'text-textSecondary opacity-60',
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
              disabled={!(rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate) || loading || completed}
              onChange={(e) => setCreateRebookReminder(e.target.checked)}
            />
            <span>
              Create a rebook reminder{' '}
              <select
                value={rebookDaysBefore}
                disabled={!(rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate) || loading || completed}
                onChange={(e) => setRebookDaysBefore(e.target.value)}
                className={[
                  'mx-1 rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-xs font-black text-textPrimary',
                  !(rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate) || loading || completed
                    ? 'opacity-60 cursor-not-allowed'
                    : '',
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
              disabled={loading || completed}
              onChange={(e) => setCreateProductReminder(e.target.checked)}
            />
            <span>
              Create a product follow-up{' '}
              <select
                value={productDaysAfter}
                disabled={loading || completed}
                onChange={(e) => setProductDaysAfter(e.target.value)}
                className={[
                  'mx-1 rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-xs font-black text-textPrimary',
                  loading || completed ? 'opacity-60 cursor-not-allowed' : '',
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

          <div className="mt-2 text-xs font-semibold text-textSecondary">
            These go into your Reminders tab so Future You remembers to check in.
          </div>
        </div>

        {error ? <div className="mt-3 text-sm font-semibold text-microAccent">{error}</div> : null}

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={loading || !!windowError || completed}
            className={primaryBtn(Boolean(loading || !!windowError || completed))}
          >
            {loading ? 'Sending…' : completed ? 'Sent' : 'Send aftercare'}
          </button>
        </div>
      </form>
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
        const deleted = isDeletedByClient(m)
        const thumb = m.thumbUrl || m.url
        const isVideo = m.mediaType === 'VIDEO'

        if (deleted) {
          return (
            <div
              key={m.id}
              className="grid aspect-square place-items-center rounded-card border border-white/10 bg-bgPrimary p-2 text-center"
              title="Private · Deleted by client"
            >
              <div className="text-xs font-black text-textPrimary">Private</div>
              <div className="text-xs font-semibold text-textSecondary">Deleted by client</div>
            </div>
          )
        }

        return (
          <a
            key={m.id}
            href={m.url}
            target="_blank"
            rel="noreferrer"
            className={[
              'relative block aspect-square overflow-hidden rounded-card bg-bgPrimary',
              m.visibility === 'PRIVATE' ? 'border border-white/10' : 'border border-transparent',
            ].join(' ')}
            title={m.visibility === 'PRIVATE' ? 'Private' : 'Open'}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt="Booking media"
              className={['h-full w-full object-cover', m.visibility === 'PRIVATE' ? 'blur-md opacity-80' : ''].join(' ')}
            />

            {isVideo ? (
              <div className="absolute right-2 top-2 rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-[10px] font-black text-textPrimary">
                VIDEO
              </div>
            ) : null}

            {m.visibility === 'PRIVATE' ? (
              <div className="absolute bottom-2 left-2 rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-[10px] font-black text-textPrimary">
                PRIVATE
              </div>
            ) : null}
          </a>
        )
      })}
    </div>
  )
}
