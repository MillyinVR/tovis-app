// app/pro/calendar/CreateBookingModal.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone, zonedTimeToUtc, getZonedParts } from '@/lib/timeZone'

type WorkingHoursJson =
  | {
      [key: string]: { enabled: boolean; start: string; end: string }
    }
  | null

type ClientLite = { id: string; fullName: string; email: string | null; phone: string | null }
type ServiceLite = { id: string; name: string; durationMinutes?: number | null }

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const SNAP_MINUTES = 15

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function snapMinutes(mins: number) {
  return Math.round(mins / SNAP_MINUTES) * SNAP_MINUTES
}

function roundToSnapMinutes(mins: number) {
  return clamp(snapMinutes(mins), SNAP_MINUTES, 12 * 60)
}

function parseHHMM(hhmm: string) {
  const [hhStr, mmStr] = (hhmm || '').split(':')
  const hh = Number(hhStr)
  const mm = Number(mmStr)
  return {
    hour: Number.isFinite(hh) ? clamp(hh, 0, 23) : 0,
    minute: Number.isFinite(mm) ? clamp(mm, 0, 59) : 0,
  }
}

function toDateInputValueFromParts(parts: { year: number; month: number; day: number }) {
  const yyyy = String(parts.year)
  const mm = String(parts.month).padStart(2, '0')
  const dd = String(parts.day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toTimeInputValueFromParts(parts: { hour: number; minute: number }) {
  const hh = String(parts.hour).padStart(2, '0')
  const mm = String(parts.minute).padStart(2, '0')
  return `${hh}:${mm}`
}

function getWorkingWindowForDayKey(dayKey: (typeof DAY_KEYS)[number], workingHours: WorkingHoursJson) {
  if (!workingHours) return null
  const cfg = (workingHours as any)[dayKey]
  if (!cfg || !cfg.enabled || !cfg.start || !cfg.end) return null

  const start = parseHHMM(String(cfg.start))
  const end = parseHHMM(String(cfg.end))

  const startMinutes = start.hour * 60 + start.minute
  const endMinutes = end.hour * 60 + end.minute
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
  initialStart: Date // UTC instant you clicked (or “now”)
  timeZone: string // ✅ pro timezone (IANA) (may be empty before setup)
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

  // ✅ Never default to LA. Use DEFAULT_TIME_ZONE when missing/invalid.
  const tz = useMemo(() => sanitizeTimeZone(props.timeZone, DEFAULT_TIME_ZONE), [props.timeZone])

  const init = useMemo(() => {
    // UTC instant -> wall clock parts in tz -> snap minutes
    const p = getZonedParts(initialStart, tz)
    const snapped = snapMinutes(p.hour * 60 + p.minute)
    const hour = clamp(Math.floor(snapped / 60), 0, 23)
    const minute = clamp(snapped % 60, 0, 59)

    return {
      date: toDateInputValueFromParts({ year: p.year, month: p.month, day: p.day }),
      time: toTimeInputValueFromParts({ hour, minute }),
    }
  }, [initialStart, tz])

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

  function close() {
    if (saving) return
    onClose()
  }

  useEffect(() => {
    if (!open) return

    setErr(null)
    setSelectedClient(null)
    setClientQuery('')
    setRecentClients([])
    setOtherClients([])
    setSearching(false)

    setSelectedServiceIds([])
    setInternalNotes('')
    setBufferMinutes(0)

    setDateStr(init.date)
    setTimeStr(init.time)

    // services
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
  }, [open, init.date, init.time, servicesProp])

  useEffect(() => {
    if (!open) return

    if (debounceRef.current) window.clearTimeout(debounceRef.current)

    const q = clientQuery.trim()
    if (!q) {
      // clear search results
      lastSearchIdRef.current += 1
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
    return roundToSnapMinutes(base)
  }, [selectedServices])

  const wallClock = useMemo(() => {
    const [yyyy, mm, dd] = (dateStr || '').split('-').map((x) => Number(x))
    if (!yyyy || !mm || !dd) return null
    const t = parseHHMM(timeStr)
    return { year: yyyy, month: mm, day: dd, hour: t.hour, minute: t.minute }
  }, [dateStr, timeStr])

  const outsideHours = useMemo(() => {
    if (!wallClock) return false

    // wall clock -> UTC instant (validity + weekday calc)
    const startUtc = zonedTimeToUtc({
      year: wallClock.year,
      month: wallClock.month,
      day: wallClock.day,
      hour: wallClock.hour,
      minute: wallClock.minute,
      second: 0,
      timeZone: tz,
    })

    if (!Number.isFinite(startUtc.getTime())) return true

    // Determine weekday in TZ for this instant (matches the selected wall-clock day)
    const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
      .format(startUtc)
      .slice(0, 3)
      .toLowerCase()

    const dayKey = (DAY_KEYS as readonly string[]).includes(weekdayShort)
      ? (weekdayShort as (typeof DAY_KEYS)[number])
      : null
    if (!dayKey) return true

    const window = getWorkingWindowForDayKey(dayKey, workingHours)
    if (!window) return true

    const startM = wallClock.hour * 60 + wallClock.minute
    const endM = startM + computedDuration + (Number(bufferMinutes) || 0)

    return startM < window.startMinutes || endM > window.endMinutes
  }, [wallClock, workingHours, computedDuration, bufferMinutes, tz])

  async function createBooking() {
    if (saving) return

    if (!selectedClient) {
      setErr('Select a client.')
      return
    }
    if (!wallClock) {
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
      const startUtc = zonedTimeToUtc({
        year: wallClock.year,
        month: wallClock.month,
        day: wallClock.day,
        hour: wallClock.hour,
        minute: wallClock.minute,
        second: 0,
        timeZone: tz,
      })

      if (!Number.isFinite(startUtc.getTime())) throw new Error('Invalid start time.')

      const payload = {
        clientId: selectedClient.id,
        scheduledFor: startUtc.toISOString(),
        serviceIds: selectedServiceIds,
        totalDurationMinutes: computedDuration,
        bufferMinutes: Number(bufferMinutes) || 0,
        internalNotes: internalNotes.trim() ? internalNotes.trim() : null,
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

      close()
    } catch (e: any) {
      console.error(e)
      setErr(e?.message || 'Failed to create booking.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-1300 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div
        className="w-full max-w-720px overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div className="font-extrabold">Schedule appointment</div>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-xs font-semibold hover:bg-bgSecondary/70 disabled:opacity-70"
          >
            Close
          </button>
        </div>

        <div className="p-4">
          {outsideHours && (
            <div className="mb-3 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
              <div className="font-extrabold">Outside working hours</div>
              <div className="mt-1 text-textSecondary">
                You can still schedule this manually, but clients can’t book this time slot.
              </div>
              <div className="mt-2 text-xs text-textSecondary">
                Timezone: <span className="font-semibold text-textPrimary">{tz}</span>
              </div>
            </div>
          )}

          {err && <div className="mb-2 text-sm text-toneDanger">{err}</div>}

          {/* Client search */}
          <div className="mb-4">
            <div className="mb-1 text-xs text-textSecondary">Find client</div>
            <input
              ref={inputRef}
              value={clientQuery}
              onChange={(e) => setClientQuery(e.target.value)}
              placeholder="Search by phone, name, or email"
              className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm"
            />

            {!!clientQuery.trim() && (
              <div className="mt-2 text-xs text-textSecondary">
                Results: {recentClients.length} your clients, {otherClients.length} other{searching ? ' (searching...)' : ''}
              </div>
            )}

            {selectedClient && (
              <div className="mt-2 text-sm text-textSecondary">
                Selected: <span className="font-semibold text-textPrimary">{selectedClient.fullName}</span>
                <button
                  type="button"
                  onClick={() => setSelectedClient(null)}
                  className="ml-2 rounded-full border border-white/10 bg-bgSecondary px-3 py-1 text-xs font-semibold hover:bg-bgSecondary/70"
                >
                  Clear
                </button>
              </div>
            )}

            {!selectedClient && (recentClients.length > 0 || otherClients.length > 0 || searching) && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-bgSecondary/30">
                {searching && <div className="p-3 text-sm text-textSecondary">Searching…</div>}

                {recentClients.length > 0 && (
                  <div className="p-3">
                    <div className="mb-2 text-xs font-extrabold text-textSecondary">Your clients</div>
                    <div className="grid gap-2">
                      {recentClients.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedClient(c)}
                          className="rounded-2xl border border-white/10 bg-bgPrimary p-3 text-left hover:bg-bgSecondary/30"
                        >
                          <div className="text-sm font-extrabold text-textPrimary">{c.fullName}</div>
                          <div className="text-xs text-textSecondary">{c.email || c.phone || ''}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {otherClients.length > 0 && (
                  <div className={`p-3 ${recentClients.length ? 'border-t border-white/10' : ''}`}>
                    <div className="mb-2 text-xs font-extrabold text-textSecondary">Other clients</div>
                    <div className="grid gap-2">
                      {otherClients.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedClient(c)}
                          className="rounded-2xl border border-white/10 bg-bgPrimary p-3 text-left hover:bg-bgSecondary/30"
                        >
                          <div className="text-sm font-extrabold text-textPrimary">{c.fullName}</div>
                          <div className="text-xs text-textSecondary">{c.email || c.phone || ''}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Date / time */}
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs text-textSecondary">Date</div>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-textSecondary">Time</div>
              <input
                type="time"
                step={SNAP_MINUTES * 60}
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Services */}
          <div className="mb-4">
            <div className="mb-2 text-xs text-textSecondary">Services</div>

            {services.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-bgSecondary/30 p-3 text-sm text-textSecondary">
                No services found. Add services first.
              </div>
            ) : (
              <div className="grid gap-2">
                {services.map((s) => {
                  const id = String(s.id)
                  const checked = selectedServiceIds.includes(id)
                  const dur = Number(s.durationMinutes ?? 0) || 0

                  return (
                    <label key={s.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-bgSecondary/30 p-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedServiceIds((prev) =>
                            e.target.checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id),
                          )
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-extrabold text-textPrimary">{s.name}</div>
                        <div className="text-xs text-textSecondary">{dur ? `${dur} min` : 'Duration not set'}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}

            <div className="mt-2 text-sm text-textSecondary">
              Total duration: <span className="font-extrabold text-textPrimary">{computedDuration} min</span>
            </div>
          </div>

          {/* Buffer + Notes */}
          <div className="mb-4 grid grid-cols-[140px_1fr] gap-2">
            <div>
              <div className="mb-1 text-xs text-textSecondary">Buffer (min)</div>
              <input
                type="number"
                min={0}
                max={180}
                step={5}
                value={bufferMinutes}
                onChange={(e) => setBufferMinutes(Number(e.target.value))}
                className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-textSecondary">Internal notes (pro-only)</div>
              <input
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Notes the client never sees…"
                className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              disabled={saving}
              className="rounded-full border border-white/10 bg-transparent px-4 py-2 text-xs font-semibold hover:bg-bgSecondary/40 disabled:opacity-70"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createBooking()}
              disabled={saving}
              className="rounded-full bg-bgSecondary px-4 py-2 text-xs font-extrabold hover:bg-bgSecondary/70 disabled:opacity-70"
            >
              {saving ? 'Saving…' : 'Create booking'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
