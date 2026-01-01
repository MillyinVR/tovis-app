// app/pro/bookings/[id]/aftercare/AftercareForm.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

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
  existingNotes: string

  existingRebookedFor: string | null
  existingRebookMode?: RebookMode | null
  existingRebookWindowStart?: string | null
  existingRebookWindowEnd?: string | null

  existingMedia: MediaItem[]

  // ✅ passed from server page
  existingRecommendedProducts?: RecommendedProduct[]
}

const MAX_PRODUCTS = 10
const PRODUCT_NAME_MAX = 80
const PRODUCT_NOTE_MAX = 140
const NOTES_MAX = 4000

function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function toISOFromDatetimeLocal(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

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

function ModeChip({
  active,
  onClick,
  disabled,
  children,
  title,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        borderRadius: 999,
        border: `1px solid ${active ? '#111' : '#d1d5db'}`,
        background: active ? '#111' : '#fff',
        color: active ? '#fff' : '#111',
        padding: '6px 10px',
        fontSize: 12,
        fontWeight: 800,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.2, color: '#111' }}>{children}</div>
}

function SubtleText({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: '#6b7280' }}>{children}</div>
}

export default function AftercareForm({
  bookingId,
  existingNotes,
  existingRebookedFor,
  existingRebookMode,
  existingRebookWindowStart,
  existingRebookWindowEnd,
  existingMedia,
  existingRecommendedProducts,
}: Props) {
  const router = useRouter()

  const [notes, setNotes] = useState((existingNotes || '').slice(0, NOTES_MAX))

  const [products, setProducts] = useState<RecommendedProduct[]>([])
  const [productsError, setProductsError] = useState<string | null>(null)

  const [rebookMode, setRebookMode] = useState<RebookMode>('NONE')
  const [rebookAt, setRebookAt] = useState<string>('')
  const [windowStart, setWindowStart] = useState<string>('')
  const [windowEnd, setWindowEnd] = useState<string>('')

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

    if (existingRebookedFor) setRebookAt(isoToLocalInput(existingRebookedFor))
    if (existingRebookWindowStart) setWindowStart(isoToLocalInput(existingRebookWindowStart))
    if (existingRebookWindowEnd) setWindowEnd(isoToLocalInput(existingRebookWindowEnd))

    if (existingRebookedFor) setCreateRebookReminder(true)

    setProducts(
      (existingRecommendedProducts || []).slice(0, MAX_PRODUCTS).map((p) => ({
        id: p.id || crypto.randomUUID(),
        name: p.name || '',
        url: p.url || '',
        note: p.note || '',
      })),
    )
  }, [existingRebookMode, existingRebookedFor, existingRebookWindowStart, existingRebookWindowEnd, existingRecommendedProducts])

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
          const startISO = toISOFromDatetimeLocal(windowStart)
          const endISO = toISOFromDatetimeLocal(windowEnd)
          if (!startISO || !endISO) return 'Pick both a window start and end.'
          const a = new Date(startISO)
          const b = new Date(endISO)
          if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 'Window dates are invalid.'
          if (b <= a) return 'Window end must be after window start.'
          return null
        })()
      : null

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
    setProducts((p) => [...p, { id: crypto.randomUUID(), name: '', url: '', note: '' }])
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

    const rebookISO = toISOFromDatetimeLocal(rebookAt)
    const windowStartISO = toISOFromDatetimeLocal(windowStart)
    const windowEndISO = toISOFromDatetimeLocal(windowEnd)

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
    <div style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          borderRadius: 12,
          border: '1px solid #fecaca',
          background: '#fff1f2',
          padding: 14,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 900, color: '#9f1239' }}>Visible to client</div>
        <div style={{ fontSize: 12, color: '#9f1239', marginTop: 4 }}>
          Everything you add on this page will be shown to the client as their official appointment summary.
        </div>
      </div>

      {completed && (
        <div
          style={{
            borderRadius: 12,
            border: '1px solid #bbf7d0',
            background: '#f0fdf4',
            padding: 16,
            display: 'grid',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 900, color: '#166534' }}>Aftercare sent</div>
          <div style={{ fontSize: 12, color: '#166534' }}>The client can now view their summary and rebook guidance.</div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={goCalendar}
              style={{
                borderRadius: 999,
                border: '1px solid #166534',
                background: '#166534',
                color: '#fff',
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Back to calendar
            </button>

            <button
              type="button"
              onClick={goDashboard}
              style={{
                borderRadius: 999,
                border: '1px solid #166534',
                background: '#fff',
                color: '#166534',
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Dashboard overview
            </button>
          </div>
        </div>
      )}

      <div style={{ borderRadius: 12, border: '1px solid #eee', background: '#fff', padding: 16 }}>
        <SectionTitle>Photos</SectionTitle>
        <SubtleText>These appear in the client’s appointment summary.</SubtleText>

        <div style={{ marginTop: 10, display: 'grid', gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 900 }}>Before</div>
            <SubtleText>Before photos/videos from this appointment.</SubtleText>
            <MediaGrid items={beforeMedia} />
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 900 }}>After</div>
            <SubtleText>After photos/videos from this appointment.</SubtleText>
            <MediaGrid items={afterMedia} />
          </div>

          {otherMedia.length > 0 ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 900 }}>Other</div>
              <SubtleText>Extra photos/videos attached to this appointment.</SubtleText>
              <MediaGrid items={otherMedia} />
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ borderRadius: 12, border: '1px solid #eee', background: '#fff', padding: 16 }}>
        <SectionTitle>Recommended products</SectionTitle>
        <SubtleText>Add products with links (Amazon storefront, pro shop, etc.). Links must be http/https.</SubtleText>

        <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
          {products.length === 0 ? (
            <div style={{ fontSize: 12, color: '#6b7280' }}>No products added yet.</div>
          ) : (
            products.map((p, idx) => (
              <div
                key={p.id}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 12,
                  padding: 12,
                  display: 'grid',
                  gap: 8,
                  background: '#fafafa',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 900 }}>Product {idx + 1}</div>
                  <button
                    type="button"
                    onClick={() => removeProduct(p.id)}
                    disabled={loading || completed}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: 999,
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 900,
                      background: '#fff',
                      cursor: loading || completed ? 'not-allowed' : 'pointer',
                      opacity: loading || completed ? 0.6 : 1,
                    }}
                  >
                    Remove
                  </button>
                </div>

                <div style={{ display: 'grid', gap: 8 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Product name</label>
                    <input
                      value={p.name}
                      disabled={loading || completed}
                      maxLength={PRODUCT_NAME_MAX}
                      onChange={(e) => updateProduct(p.id, { name: e.target.value })}
                      placeholder="e.g. Sulfate-free shampoo"
                      style={{
                        width: '100%',
                        borderRadius: 8,
                        border: '1px solid #ddd',
                        padding: 8,
                        fontSize: 13,
                        fontFamily: 'inherit',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Product link</label>
                    <input
                      value={p.url}
                      disabled={loading || completed}
                      onChange={(e) => updateProduct(p.id, { url: e.target.value })}
                      placeholder="https://amazon.com/..."
                      style={{
                        width: '100%',
                        borderRadius: 8,
                        border: '1px solid #ddd',
                        padding: 8,
                        fontSize: 13,
                        fontFamily: 'inherit',
                      }}
                    />
                    {p.url.trim() && !isValidHttpUrl(p.url) ? (
                      <div style={{ marginTop: 4, fontSize: 11, color: '#b91c1c' }}>Link must be a valid http/https URL.</div>
                    ) : null}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Note (optional)</label>
                    <input
                      value={pickString(p.note)}
                      disabled={loading || completed}
                      maxLength={PRODUCT_NOTE_MAX}
                      onChange={(e) => updateProduct(p.id, { note: e.target.value })}
                      placeholder="e.g. Use 2–3x/week to maintain shine"
                      style={{
                        width: '100%',
                        borderRadius: 8,
                        border: '1px solid #ddd',
                        padding: 8,
                        fontSize: 13,
                        fontFamily: 'inherit',
                      }}
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
            style={{
              borderRadius: 999,
              border: '1px solid #111',
              background: products.length >= MAX_PRODUCTS ? '#e5e7eb' : '#fff',
              color: '#111',
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 900,
              cursor: loading || completed || products.length >= MAX_PRODUCTS ? 'not-allowed' : 'pointer',
              opacity: loading || completed ? 0.7 : 1,
              justifySelf: 'start',
            }}
          >
            + Add product
          </button>

          {productsError ? <div style={{ fontSize: 12, color: '#b91c1c' }}>{productsError}</div> : null}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          borderRadius: 12,
          border: '1px solid #eee',
          padding: 16,
          background: '#fff',
          display: 'grid',
          gap: 12,
          fontSize: 13,
          opacity: completed ? 0.85 : 1,
        }}
      >
        <SectionTitle>Aftercare instructions</SectionTitle>
        <SubtleText>Write this like doctor instructions: clear, specific, and actionable.</SubtleText>

        <div>
          <label htmlFor="notes" style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            Notes
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
            rows={5}
            disabled={loading || completed}
            placeholder="E.g. wash after 48 hours, use sulfate-free shampoo, avoid tight ponytails for 7 days…"
            style={{
              width: '100%',
              borderRadius: 8,
              border: '1px solid #ddd',
              padding: 8,
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
            {notes.length}/{NOTES_MAX}
          </div>
        </div>

        <div style={{ borderRadius: 12, border: '1px solid #eee', background: '#fafafa', padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 8 }}>Rebook guidance</div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ModeChip active={rebookMode === 'NONE'} onClick={() => onChangeMode('NONE')} disabled={loading || completed}>
              None
            </ModeChip>

            <ModeChip
              active={rebookMode === 'BOOKED_NEXT_APPOINTMENT'}
              onClick={() => onChangeMode('BOOKED_NEXT_APPOINTMENT')}
              disabled={loading || completed}
              title="Recommend a single ideal next visit date"
            >
              Next visit date
            </ModeChip>

            <ModeChip
              active={rebookMode === 'RECOMMENDED_WINDOW'}
              onClick={() => onChangeMode('RECOMMENDED_WINDOW')}
              disabled={loading || completed}
              title="Recommend a date range the client should book within"
            >
              Booking window
            </ModeChip>
          </div>

          {showBooked && (
            <div style={{ marginTop: 10 }}>
              <label htmlFor="rebookAt" style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                Recommended next visit
              </label>
              <input
                id="rebookAt"
                type="datetime-local"
                value={rebookAt}
                disabled={loading || completed}
                onChange={(e) => setRebookAt(e.target.value)}
                style={{
                  width: '100%',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  padding: 8,
                  fontSize: 13,
                  fontFamily: 'inherit',
                }}
              />
              <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>This shows on the client’s summary and can power a reminder.</div>
            </div>
          )}

          {showWindow && (
            <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Window start</label>
                  <input
                    type="datetime-local"
                    value={windowStart}
                    disabled={loading || completed}
                    onChange={(e) => setWindowStart(e.target.value)}
                    style={{
                      width: '100%',
                      borderRadius: 8,
                      border: '1px solid #ddd',
                      padding: 8,
                      fontSize: 13,
                      fontFamily: 'inherit',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Window end</label>
                  <input
                    type="datetime-local"
                    value={windowEnd}
                    disabled={loading || completed}
                    onChange={(e) => setWindowEnd(e.target.value)}
                    style={{
                      width: '100%',
                      borderRadius: 8,
                      border: '1px solid #ddd',
                      padding: 8,
                      fontSize: 13,
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
              </div>

              {windowError ? (
                <div style={{ fontSize: 12, color: '#b91c1c' }}>{windowError}</div>
              ) : (
                <div style={{ fontSize: 11, color: '#777' }}>Client will be prompted to book within this range.</div>
              )}
            </div>
          )}
        </div>

        <div style={{ borderRadius: 10, border: '1px solid #eee', padding: 10, background: '#fafafa', opacity: loading || completed ? 0.9 : 1 }}>
          <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>Smart reminders</div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              marginBottom: 6,
              opacity: rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate ? 1 : 0.6,
            }}
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
                style={{
                  borderRadius: 999,
                  border: '1px solid #ddd',
                  padding: '2px 8px',
                  fontSize: 11,
                  marginLeft: 2,
                  marginRight: 2,
                }}
              >
                <option value="1">1 day</option>
                <option value="2">2 days</option>
                <option value="3">3 days</option>
                <option value="7">7 days</option>
              </select>
              before the recommended date.
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
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
                style={{
                  borderRadius: 999,
                  border: '1px solid #ddd',
                  padding: '2px 8px',
                  fontSize: 11,
                  marginLeft: 2,
                  marginRight: 2,
                }}
              >
                <option value="3">3 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
              </select>
              after the appointment.
            </span>
          </label>

          <div style={{ fontSize: 11, color: '#777', marginTop: 6 }}>These go into your Reminders tab so Future You remembers to check in.</div>
        </div>

        {error && <div style={{ fontSize: 12, color: '#b91c1c' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="submit"
            disabled={loading || !!windowError || completed}
            style={{
              padding: '8px 16px',
              borderRadius: 999,
              border: 'none',
              fontSize: 13,
              fontWeight: 900,
              background: loading || windowError || completed ? '#374151' : '#111',
              color: '#fff',
              cursor: loading || windowError || completed ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.95 : 1,
            }}
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
    return <div style={{ marginTop: 8, fontSize: 12, color: '#777' }}>None yet.</div>
  }

  return (
    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
      {items.map((m) => {
        const deleted = isDeletedByClient(m)
        const thumb = m.thumbUrl || m.url
        const isVideo = m.mediaType === 'VIDEO'

        if (deleted) {
          return (
            <div
              key={m.id}
              style={{
                aspectRatio: '1 / 1',
                borderRadius: 10,
                border: '1px solid #f1f5f9',
                background: '#f8fafc',
                display: 'grid',
                placeItems: 'center',
                padding: 10,
                textAlign: 'center',
                color: '#64748b',
                fontSize: 11,
              }}
              title="Private · Deleted by client"
            >
              <div style={{ fontWeight: 700 }}>Private</div>
              <div>Deleted by client</div>
            </div>
          )
        }

        return (
          <a
            key={m.id}
            href={m.url}
            target="_blank"
            rel="noreferrer"
            style={{
              position: 'relative',
              display: 'block',
              aspectRatio: '1 / 1',
              borderRadius: 10,
              overflow: 'hidden',
              background: '#f3f4f6',
              textDecoration: 'none',
              border: m.visibility === 'PRIVATE' ? '1px solid #e5e7eb' : 'none',
            }}
            title={m.visibility === 'PRIVATE' ? 'Private' : 'Open'}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt="Booking media"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                filter: m.visibility === 'PRIVATE' ? 'blur(10px)' : 'none',
                opacity: m.visibility === 'PRIVATE' ? 0.8 : 1,
              }}
            />

            {isVideo && (
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  background: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 999,
                }}
              >
                VIDEO
              </div>
            )}

            {m.visibility === 'PRIVATE' && (
              <div
                style={{
                  position: 'absolute',
                  left: 8,
                  bottom: 8,
                  background: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 999,
                }}
              >
                PRIVATE
              </div>
            )}
          </a>
        )
      })}
    </div>
  )
}
