// app/pro/calendar/CreateBookingModal.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type WorkingHoursJson =
  | {
      [key: string]: { enabled: boolean; start: string; end: string }
    }
  | null

type ClientLite = { id: string; fullName: string; email: string | null; phone: string | null }
type ServiceLite = { id: string; name: string; durationMinutes?: number | null }

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function toDateInputValue(d: Date) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toTimeInputValue(d: Date) {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function setDateTimeParts(baseDate: Date, hhmm: string) {
  const [hhStr, mmStr] = (hhmm || '').split(':')
  const hh = Number(hhStr)
  const mm = Number(mmStr)
  const out = new Date(baseDate)
  out.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0)
  return out
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function roundTo15(mins: number) {
  const snapped = Math.round(mins / 15) * 15
  return clamp(snapped, 15, 12 * 60)
}

function parseHHMM(hhmm: string) {
  const [h, m] = (hhmm || '').split(':').map((x) => parseInt(x, 10) || 0)
  return h * 60 + m
}

function getWorkingWindowForDate(date: Date, workingHours: WorkingHoursJson) {
  if (!workingHours) return null
  const key = DAY_KEYS[date.getDay()]
  const cfg = (workingHours as any)[key]
  if (!cfg || !cfg.enabled || !cfg.start || !cfg.end) return null
  const startMinutes = parseHHMM(String(cfg.start))
  const endMinutes = parseHHMM(String(cfg.end))
  if (endMinutes <= startMinutes) return null
  return { startMinutes, endMinutes }
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function coerceClients(data: any): { recent: ClientLite[]; other: ClientLite[] } {
  const recent = (data?.prioritized || data?.recentClients || []) as ClientLite[]
  const other = (data?.others || data?.otherClients || []) as ClientLite[]
  return { recent: Array.isArray(recent) ? recent : [], other: Array.isArray(other) ? other : [] }
}

export default function CreateBookingModal(props: {
  open: boolean
  onClose: () => void
  workingHours: WorkingHoursJson
  initialStart: Date
  snapMinutes?: number
  services?: ServiceLite[]
  onCreated: (ev: {
    id: string
    startsAt: string
    endsAt: string
    title: string
    clientName: string
    status: any
    durationMinutes?: number
  }) => void
}) {
  const { open, onClose, workingHours, initialStart, onCreated, services: servicesProp } = props

  const [clientQuery, setClientQuery] = useState('')
  const [recentClients, setRecentClients] = useState<ClientLite[]>([])
  const [otherClients, setOtherClients] = useState<ClientLite[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedClient, setSelectedClient] = useState<ClientLite | null>(null)

  const [services, setServices] = useState<ServiceLite[]>([])
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])

  const [dateStr, setDateStr] = useState('')
  const [timeStr, setTimeStr] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [bufferMinutes, setBufferMinutes] = useState(0)

  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const debounceRef = useRef<number | null>(null)

  // race-cancel for search
  const lastSearchIdRef = useRef(0)

  useEffect(() => {
    if (!open) return

    setErr(null)
    setSelectedClient(null)
    setClientQuery('')
    setRecentClients([])
    setOtherClients([])
    setSelectedServiceIds([])
    setInternalNotes('')
    setBufferMinutes(0)

    setDateStr(toDateInputValue(initialStart))
    setTimeStr(toTimeInputValue(initialStart))

    // load services (prefer prop from calendar page)
    if (servicesProp && servicesProp.length) {
      setServices(servicesProp)
    } else {
      ;(async () => {
        try {
          const res = await fetch('/api/pro/services', { cache: 'no-store' })
          const data = await safeJson(res)
          if (!res.ok) {
            console.log('Load services failed:', res.status, data)
            setServices([])
            return
          }
          setServices(Array.isArray(data?.services) ? data.services : [])
        } catch (e) {
          console.log('Load services threw:', e)
          setServices([])
        }
      })()
    }

    window.setTimeout(() => inputRef.current?.focus(), 50)
  }, [open, initialStart, servicesProp])

  useEffect(() => {
    if (!open) return
    if (debounceRef.current) window.clearTimeout(debounceRef.current)

    const q = clientQuery.trim()
    if (!q) {
      setRecentClients([])
      setOtherClients([])
      setSearching(false)
      return
    }

    debounceRef.current = window.setTimeout(async () => {
      const mySearchId = ++lastSearchIdRef.current
      setSearching(true)

      try {
        const res = await fetch(`/api/pro/clients/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        const data = await safeJson(res)

        // if a newer search started, ignore this result
        if (mySearchId !== lastSearchIdRef.current) return

        if (!res.ok) {
          console.log('Client search failed:', res.status, data)
          throw new Error(data?.error || 'Search failed.')
        }

        const { recent, other } = coerceClients(data)
        setRecentClients(recent)
        setOtherClients(other)
      } catch (e: any) {
        if (mySearchId !== lastSearchIdRef.current) return
        console.log('Client search error:', e)
        setRecentClients([])
        setOtherClients([])
      } finally {
        if (mySearchId === lastSearchIdRef.current) setSearching(false)
      }
    }, 150)

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [clientQuery, open])

  const selectedServices = useMemo(
    () => services.filter((s) => selectedServiceIds.includes(String(s.id))),
    [services, selectedServiceIds],
  )

  const computedDuration = useMemo(() => {
    const sum = selectedServices.reduce((acc, s) => acc + (Number(s.durationMinutes ?? 0) || 0), 0)
    const base = sum > 0 ? sum : 60
    return roundTo15(base)
  }, [selectedServices])

  const startDate = useMemo(() => {
    const [yyyy, mm, dd] = (dateStr || '').split('-').map((x) => Number(x))
    if (!yyyy || !mm || !dd) return null
    const base = new Date(yyyy, mm - 1, dd, 0, 0, 0, 0)
    return setDateTimeParts(base, timeStr)
  }, [dateStr, timeStr])

  const outsideHours = useMemo(() => {
    if (!startDate) return false
    const window = getWorkingWindowForDate(startDate, workingHours)
    if (!window) return true
    const startM = startDate.getHours() * 60 + startDate.getMinutes()
    const endM = startM + computedDuration + (Number(bufferMinutes) || 0)
    return startM < window.startMinutes || endM > window.endMinutes
  }, [startDate, workingHours, computedDuration, bufferMinutes])

  if (!open) return null

  async function createBooking() {
    if (!selectedClient) {
      setErr('Select a client.')
      return
    }
    if (!startDate || Number.isNaN(startDate.getTime())) {
      setErr('Pick a valid date/time.')
      return
    }
    if (!selectedServiceIds.length) {
      setErr('Select at least one service.')
      return
    }

    setErr(null)
    setSaving(true)

    try {
      const payload = {
        clientId: selectedClient.id,
        scheduledFor: startDate.toISOString(),
        serviceIds: selectedServiceIds,
        totalDurationMinutes: computedDuration,
        bufferMinutes: Number(bufferMinutes) || 0,
        internalNotes: internalNotes || null,
      }

      const res = await fetch('/api/pro/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await safeJson(res)

      if (!res.ok) {
        console.log('Create booking failed:', res.status, data, payload)
        throw new Error(data?.error || 'Failed to create booking.')
      }

      const b = data?.booking
      if (!b?.id) {
        console.log('Create booking bad response:', data)
        throw new Error('Server did not return booking.id')
      }

      onCreated({
        id: String(b.id),
        startsAt: b.scheduledFor,
        endsAt: b.endsAt,
        title: b.serviceName || 'Appointment',
        clientName: b.clientName || selectedClient.fullName,
        status: b.status || 'ACCEPTED',
        durationMinutes: Number(b.totalDurationMinutes ?? computedDuration),
      })

      onClose()
    } catch (e: any) {
      console.error(e)
      setErr(e?.message || 'Failed to create booking.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 1300,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 720,
          background: '#fff',
          borderRadius: 14,
          border: '1px solid #eee',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 14,
            borderBottom: '1px solid #eee',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontWeight: 900 }}>Schedule appointment</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: '1px solid #ddd',
              background: '#fff',
              borderRadius: 999,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Close
          </button>
        </div>

        <div style={{ padding: 14 }}>
          {outsideHours && (
            <div
              style={{
                border: '1px solid #f59e0b',
                background: '#fffbeb',
                color: '#92400e',
                padding: 10,
                borderRadius: 10,
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              This appointment is <b>outside your working hours</b>. You can still schedule it, but clients can’t book
              this time.
            </div>
          )}

          {err && (
            <div style={{ fontSize: 12, color: 'red', marginBottom: 8 }}>
              {err}
            </div>
          )}

          {/* Client search */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Find client</div>
            <input
              ref={inputRef}
              value={clientQuery}
              onChange={(e) => setClientQuery(e.target.value)}
              placeholder="Search by phone, name, or email"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }}
            />

            {/* tiny state hint so you can debug without guessing */}
            {!!clientQuery.trim() && (
              <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
                Results: {recentClients.length} your clients, {otherClients.length} other{searching ? ' (searching...)' : ''}
              </div>
            )}

            {selectedClient && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                Selected: <b>{selectedClient.fullName}</b>
                <button
                  type="button"
                  onClick={() => setSelectedClient(null)}
                  style={{
                    marginLeft: 10,
                    border: '1px solid #ddd',
                    background: '#fff',
                    borderRadius: 999,
                    padding: '2px 8px',
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                >
                  Clear
                </button>
              </div>
            )}

            {!selectedClient && (recentClients.length > 0 || otherClients.length > 0 || searching) && (
              <div style={{ marginTop: 8, border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                {searching && <div style={{ padding: 10, fontSize: 12, color: '#666' }}>Searching…</div>}

                {recentClients.length > 0 && (
                  <div style={{ padding: 10, borderTop: '1px solid #eee' }}>
                    <div style={{ fontSize: 11, color: '#666', fontWeight: 800, marginBottom: 6 }}>Your clients</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {recentClients.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedClient(c)}
                          style={{
                            textAlign: 'left',
                            border: '1px solid #eee',
                            background: '#fff',
                            borderRadius: 10,
                            padding: 10,
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 900 }}>{c.fullName}</div>
                          <div style={{ fontSize: 11, color: '#666' }}>{c.email || c.phone || ''}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {otherClients.length > 0 && (
                  <div style={{ padding: 10, borderTop: recentClients.length ? '1px solid #eee' : 'none' }}>
                    <div style={{ fontSize: 11, color: '#666', fontWeight: 800, marginBottom: 6 }}>Other clients</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {otherClients.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedClient(c)}
                          style={{
                            textAlign: 'left',
                            border: '1px solid #eee',
                            background: '#fff',
                            borderRadius: 10,
                            padding: 10,
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 900 }}>{c.fullName}</div>
                          <div style={{ fontSize: 11, color: '#666' }}>{c.email || c.phone || ''}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Date / time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Date</div>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Time</div>
              <input
                type="time"
                step={15 * 60}
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }}
              />
            </div>
          </div>

          {/* Services */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>Services</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {services.length === 0 ? (
                <div style={{ fontSize: 12, color: '#666' }}>No services found. Add services first.</div>
              ) : (
                services.map((s) => {
                  const checked = selectedServiceIds.includes(String(s.id))
                  return (
                    <label
                      key={s.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #eee', borderRadius: 10, padding: 10 }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const id = String(s.id)
                          setSelectedServiceIds((prev) =>
                            e.target.checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id),
                          )
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#666' }}>
                          {(Number(s.durationMinutes ?? 0) || 0) ? `${Number(s.durationMinutes)} min` : 'Duration not set'}
                        </div>
                      </div>
                    </label>
                  )
                })
              )}
            </div>

            <div style={{ marginTop: 8, fontSize: 12, color: '#111' }}>
              Total duration: <b>{computedDuration} min</b>
            </div>
          </div>

          {/* Buffer + Notes */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Buffer (min)</div>
              <input
                type="number"
                min={0}
                max={180}
                step={5}
                value={bufferMinutes}
                onChange={(e) => setBufferMinutes(Number(e.target.value))}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Internal notes (pro-only)</div>
              <input
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Notes the client never sees…"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 999, padding: '10px 12px', cursor: saving ? 'default' : 'pointer', fontSize: 12 }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createBooking()}
              disabled={saving}
              style={{
                border: 'none',
                background: '#111',
                color: '#fff',
                borderRadius: 999,
                padding: '10px 12px',
                cursor: saving ? 'default' : 'pointer',
                fontSize: 12,
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Create booking'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
