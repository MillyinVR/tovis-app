'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type MediaType = 'IMAGE' | 'VIDEO'
type MediaVisibility = 'PUBLIC' | 'PRIVATE'
type Role = 'CLIENT' | 'PRO' | 'ADMIN'

type MediaItem = {
  id: string
  url: string
  thumbUrl: string | null
  mediaType: MediaType
  visibility: MediaVisibility
  uploadedByRole: Role | null
  reviewId: string | null
  createdAt: string
}

type RebookMode = 'NONE' | 'BOOKED_NEXT_APPOINTMENT' | 'RECOMMENDED_WINDOW'

type Props = {
  bookingId: string
  existingNotes: string

  // Backward compatible
  existingRebookedFor: string | null

  // New
  existingRebookMode?: RebookMode | null
  existingRebookWindowStart?: string | null
  existingRebookWindowEnd?: string | null

  existingMedia: MediaItem[]
}

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

export default function AftercareForm({
  bookingId,
  existingNotes,
  existingRebookedFor,
  existingRebookMode,
  existingRebookWindowStart,
  existingRebookWindowEnd,
  existingMedia,
}: Props) {
  const router = useRouter()

  const [notes, setNotes] = useState(existingNotes || '')

  // Rebook UI state
  const [rebookMode, setRebookMode] = useState<RebookMode>('NONE')
  const [rebookAt, setRebookAt] = useState<string>('') // BOOKED_NEXT_APPOINTMENT
  const [windowStart, setWindowStart] = useState<string>('') // RECOMMENDED_WINDOW
  const [windowEnd, setWindowEnd] = useState<string>('') // RECOMMENDED_WINDOW

  // Reminders
  const [createRebookReminder, setCreateRebookReminder] = useState(false)
  const [rebookDaysBefore, setRebookDaysBefore] = useState('2')

  const [createProductReminder, setCreateProductReminder] = useState(false)
  const [productDaysAfter, setProductDaysAfter] = useState('7')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // Hydrate from existing values (supports old single-date-only records)
  useEffect(() => {
    const modeFromProps =
      existingRebookMode && isRebookMode(existingRebookMode) ? existingRebookMode : null

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
  }, [existingRebookMode, existingRebookedFor, existingRebookWindowStart, existingRebookWindowEnd])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const sortedMedia = useMemo(() => {
    return [...(existingMedia || [])].sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
  }, [existingMedia])

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

  // Rebook reminder policy: only allowed for BOOKED_NEXT_APPOINTMENT (matches your server route)
  useEffect(() => {
    if (rebookMode !== 'BOOKED_NEXT_APPOINTMENT' && createRebookReminder) {
      setCreateRebookReminder(false)
    }
  }, [rebookMode, createRebookReminder])

  useEffect(() => {
    if (rebookMode === 'BOOKED_NEXT_APPOINTMENT' && !hasBookedDate && createRebookReminder) {
      setCreateRebookReminder(false)
    }
  }, [rebookMode, hasBookedDate, createRebookReminder])

  function onChangeMode(next: RebookMode) {
    setRebookMode(next)
    setError(null)
    setSavedMsg(null)

    // Clear conflicting inputs so we don’t send competing data
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSavedMsg(null)

    if (!bookingId) {
      setError('Missing booking id.')
      return
    }
    if (loading) return

    const rebookISO = toISOFromDatetimeLocal(rebookAt)
    const windowStartISO = toISOFromDatetimeLocal(windowStart)
    const windowEndISO = toISOFromDatetimeLocal(windowEnd)

    // Validate mode requirements
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

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)

    try {
      const daysBeforeRaw = parseInt(rebookDaysBefore, 10)
      const daysAfterRaw = parseInt(productDaysAfter, 10)

      const payload = {
        notes: notes?.trim() || '',

        rebookMode,
        rebookedFor: rebookMode === 'BOOKED_NEXT_APPOINTMENT' ? rebookISO : null,
        rebookWindowStart: rebookMode === 'RECOMMENDED_WINDOW' ? windowStartISO : null,
        rebookWindowEnd: rebookMode === 'RECOMMENDED_WINDOW' ? windowEndISO : null,

        createRebookReminder:
          rebookMode === 'BOOKED_NEXT_APPOINTMENT' && rebookISO ? createRebookReminder : false,
        rebookReminderDaysBefore: clampInt(daysBeforeRaw, 1, 30, 2),

        createProductReminder,
        productReminderDaysAfter: clampInt(daysAfterRaw, 1, 180, 7),
      }

      const res = await fetch(`/api/pro/bookings/${bookingId}/aftercare`, {
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

      setSavedMsg('Saved.')
      router.refresh()
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error(err)
      setError('Network error saving aftercare.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setLoading(false)
    }
  }

  const showBooked = rebookMode === 'BOOKED_NEXT_APPOINTMENT'
  const showWindow = rebookMode === 'RECOMMENDED_WINDOW'

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* MEDIA (read-only for pro in this view) */}
      <div
        style={{
          borderRadius: 12,
          border: '1px solid #eee',
          background: '#fff',
          padding: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Appointment media</div>

        {sortedMedia.length === 0 ? (
          <div style={{ fontSize: 12, color: '#777' }}>No photos/videos saved for this appointment yet.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
            {sortedMedia.map((m) => {
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
        )}
      </div>

      {/* AFTERCARE FORM */}
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
        }}
      >
        <div>
          <label htmlFor="notes" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
            Aftercare notes
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            disabled={loading}
            placeholder="E.g. wash after 48 hours, use sulfate-free shampoo, avoid tight ponytails…"
            style={{
              width: '100%',
              borderRadius: 8,
              border: '1px solid #ddd',
              padding: 8,
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'vertical',
              opacity: loading ? 0.85 : 1,
            }}
          />
        </div>

        {/* REBOOK MODE */}
        <div style={{ borderRadius: 12, border: '1px solid #eee', background: '#fafafa', padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Rebook guidance</div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ModeChip active={rebookMode === 'NONE'} onClick={() => onChangeMode('NONE')} disabled={loading}>
              None
            </ModeChip>

            <ModeChip
              active={rebookMode === 'BOOKED_NEXT_APPOINTMENT'}
              onClick={() => onChangeMode('BOOKED_NEXT_APPOINTMENT')}
              disabled={loading}
              title="Recommend a single ideal next visit date"
            >
              Next visit date
            </ModeChip>

            <ModeChip
              active={rebookMode === 'RECOMMENDED_WINDOW'}
              onClick={() => onChangeMode('RECOMMENDED_WINDOW')}
              disabled={loading}
              title="Recommend a date range the client should book within"
            >
              Booking window
            </ModeChip>
          </div>

          {showBooked && (
            <div style={{ marginTop: 10 }}>
              <label htmlFor="rebookAt" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                Recommended next visit
              </label>
              <input
                id="rebookAt"
                type="datetime-local"
                value={rebookAt}
                disabled={loading}
                onChange={(e) => setRebookAt(e.target.value)}
                style={{
                  width: '100%',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  padding: 8,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  opacity: loading ? 0.85 : 1,
                }}
              />
              <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
                Shows on the client’s chart. Can also power a reminder.
              </div>
            </div>
          )}

          {showWindow && (
            <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                    Window start
                  </label>
                  <input
                    type="datetime-local"
                    value={windowStart}
                    disabled={loading}
                    onChange={(e) => setWindowStart(e.target.value)}
                    style={{
                      width: '100%',
                      borderRadius: 8,
                      border: '1px solid #ddd',
                      padding: 8,
                      fontSize: 13,
                      fontFamily: 'inherit',
                      opacity: loading ? 0.85 : 1,
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                    Window end
                  </label>
                  <input
                    type="datetime-local"
                    value={windowEnd}
                    disabled={loading}
                    onChange={(e) => setWindowEnd(e.target.value)}
                    style={{
                      width: '100%',
                      borderRadius: 8,
                      border: '1px solid #ddd',
                      padding: 8,
                      fontSize: 13,
                      fontFamily: 'inherit',
                      opacity: loading ? 0.85 : 1,
                    }}
                  />
                </div>
              </div>

              {windowError ? (
                <div style={{ fontSize: 12, color: '#b91c1c' }}>{windowError}</div>
              ) : (
                <div style={{ fontSize: 11, color: '#777' }}>
                  Client will be prompted to book within this range.
                </div>
              )}
            </div>
          )}
        </div>

        {/* SMART REMINDERS */}
        <div style={{ borderRadius: 10, border: '1px solid #eee', padding: 10, background: '#fafafa', opacity: loading ? 0.9 : 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Smart reminders</div>

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
              disabled={!(rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate) || loading}
              onChange={(e) => setCreateRebookReminder(e.target.checked)}
            />
            <span>
              Create a rebook reminder{' '}
              <select
                value={rebookDaysBefore}
                disabled={!(rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate) || loading}
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
              disabled={loading}
              onChange={(e) => setCreateProductReminder(e.target.checked)}
            />
            <span>
              Create a product follow-up{' '}
              <select
                value={productDaysAfter}
                disabled={loading}
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

          <div style={{ fontSize: 11, color: '#777', marginTop: 6 }}>
            These go into your Reminders tab so Future You remembers to check in.
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: '#b91c1c' }}>{error}</div>}
        {savedMsg && <div style={{ fontSize: 12, color: '#16a34a' }}>{savedMsg}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="submit"
            disabled={loading || !!windowError}
            style={{
              padding: '6px 16px',
              borderRadius: 999,
              border: 'none',
              fontSize: 13,
              background: loading || windowError ? '#374151' : '#111',
              color: '#fff',
              cursor: loading || windowError ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.95 : 1,
            }}
          >
            {loading ? 'Saving…' : 'Save aftercare'}
          </button>
        </div>
      </form>
    </div>
  )
}
