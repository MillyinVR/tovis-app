// app/pro/calendar/CreateBookingModal.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone, zonedTimeToUtc, getZonedParts } from '@/lib/timeZone'
import { safeJson } from '@/lib/http'

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

type WorkingHoursJson =
  | Record<DayKey, { enabled: boolean; start: string; end: string }>
  | null

type ClientLite = { id: string; fullName: string; email: string | null; phone: string | null }
type ServiceLite = { id: string; name: string; durationMinutes?: number | null }

type LocationType = 'SALON' | 'MOBILE'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function snapToStep(mins: number, stepMinutes: number) {
  const step = clamp(Math.trunc(stepMinutes || 15), 5, 60)
  return Math.round(mins / step) * step
}

function roundDurationToStep(mins: number, stepMinutes: number) {
  const step = clamp(Math.trunc(stepMinutes || 15), 5, 60)
  const snapped = snapToStep(mins, step)
  return clamp(snapped, step, 12 * 60)
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

/* -----------------------------
   Safe runtime parsing (no any)
------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function getString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function getNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function errorFrom(data: unknown, fallback: string) {
  if (!isRecord(data)) return fallback
  return getString(data.error) ?? getString(data.message) ?? fallback
}

function coerceClients(data: unknown): { recent: ClientLite[]; other: ClientLite[] } {
  if (!isRecord(data)) return { recent: [], other: [] }

  const recentRaw = data.prioritized ?? data.recentClients
  const otherRaw = data.others ?? data.otherClients

  const recentArr = Array.isArray(recentRaw) ? recentRaw : []
  const otherArr = Array.isArray(otherRaw) ? otherRaw : []

  const parseClient = (v: unknown): ClientLite | null => {
    if (!isRecord(v)) return null
    const id = getString(v.id)
    if (!id) return null
    const fullName = getString(v.fullName) ?? 'Client'
    const email = getString(v.email)
    const phone = getString(v.phone)
    return { id, fullName, email, phone }
  }

  return {
    recent: recentArr.map(parseClient).filter((x): x is ClientLite => Boolean(x)),
    other: otherArr.map(parseClient).filter((x): x is ClientLite => Boolean(x)),
  }
}

function getWorkingWindowForDayKey(dayKey: DayKey, workingHours: WorkingHoursJson) {
  if (!workingHours) return null
  const cfg = workingHours[dayKey]
  if (!cfg || !cfg.enabled) return null

  const start = parseHHMM(String(cfg.start))
  const end = parseHHMM(String(cfg.end))

  const startMinutes = start.hour * 60 + start.minute
  const endMinutes = end.hour * 60 + end.minute
  if (endMinutes <= startMinutes) return null

  return { startMinutes, endMinutes }
}

export default function CreateBookingModal(props: {
  open: boolean
  onClose: () => void
  workingHours: WorkingHoursJson
  initialStart: Date // UTC instant you clicked (or “now”)
  timeZone: string // pro/location timezone (IANA) (may be empty before setup)
  services?: ServiceLite[]

  // ✅ REQUIRED by Prisma booking model
  locationId: string
  locationType: LocationType
  locationLabel?: string | null

  // ✅ calendar step minutes (prefer location.stepMinutes)
  stepMinutes?: number

  onCreated: (ev: {
    id: string
    startsAt: string
    endsAt: string
    title: string
    clientName: string
    status: unknown
    durationMinutes?: number
  }) => void
}) {
  const {
    open,
    onClose,
    workingHours,
    initialStart,
    onCreated,
    services: servicesProp,
    locationId,
    locationType,
    locationLabel,
    stepMinutes,
  } = props

  // ✅ Never default to LA. Use DEFAULT_TIME_ZONE when missing/invalid.
  const tz = useMemo(() => sanitizeTimeZone(props.timeZone, DEFAULT_TIME_ZONE), [props.timeZone])

  const step = useMemo(() => {
    const n = Number(stepMinutes ?? 15)
    return Number.isFinite(n) ? clamp(Math.trunc(n), 5, 60) : 15
  }, [stepMinutes])

  const init = useMemo(() => {
    // UTC instant -> wall clock parts in tz -> snap minutes
    const p = getZonedParts(initialStart, tz)
    const snapped = snapToStep(p.hour * 60 + p.minute, step)
    const hour = clamp(Math.floor(snapped / 60), 0, 23)
    const minute = clamp(snapped % 60, 0, 59)

    return {
      date: toDateInputValueFromParts({ year: p.year, month: p.month, day: p.day }),
      time: toTimeInputValueFromParts({ hour, minute }),
    }
  }, [initialStart, tz, step])

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

  const [allowOutsideHours, setAllowOutsideHours] = useState(false)

  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const debounceRef = useRef<number | null>(null)
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
    setAllowOutsideHours(false)

    setDateStr(init.date)
    setTimeStr(init.time)

    // services
    if (servicesProp && servicesProp.length) {
      setServices(servicesProp)
    } else {
      ;(async () => {
        try {
          const res = await fetch('/api/pro/services', { cache: 'no-store' })
          const data: unknown = await safeJson(res)
          if (!res.ok) {
            setServices([])
            return
          }

          if (isRecord(data) && Array.isArray(data.services)) {
            const parsed = data.services
              .filter((v) => isRecord(v) && typeof v.id === 'string' && typeof v.name === 'string')
              .map((v) => {
                const r = v as Record<string, unknown>
                return {
                  id: String(r.id),
                  name: String(r.name),
                  durationMinutes: typeof r.durationMinutes === 'number' ? r.durationMinutes : null,
                } satisfies ServiceLite
              })
            setServices(parsed)
          } else {
            setServices([])
          }
        } catch {
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
        const data: unknown = await safeJson(res)

        if (mySearchId !== lastSearchIdRef.current) return
        if (!res.ok) throw new Error(errorFrom(data, 'Search failed.'))

        const { recent, other } = coerceClients(data)
        setRecentClients(recent)
        setOtherClients(other)
      } catch {
        if (mySearchId !== lastSearchIdRef.current) return
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
    return roundDurationToStep(base, step)
  }, [selectedServices, step])

  const wallClock = useMemo(() => {
    const [yyyy, mm, dd] = (dateStr || '').split('-').map((x) => Number(x))
    if (!yyyy || !mm || !dd) return null
    const t = parseHHMM(timeStr)
    return { year: yyyy, month: mm, day: dd, hour: t.hour, minute: t.minute }
  }, [dateStr, timeStr])

  const outsideHours = useMemo(() => {
    if (!wallClock) return false

    // Use NOON for weekday derivation (DST-safe)
    const noonUtc = zonedTimeToUtc({
      year: wallClock.year,
      month: wallClock.month,
      day: wallClock.day,
      hour: 12,
      minute: 0,
      second: 0,
      timeZone: tz,
    })
    if (!Number.isFinite(noonUtc.getTime())) return true

    const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
      .format(noonUtc)
      .slice(0, 3)
      .toLowerCase()

    const dayKey = (DAY_KEYS as readonly string[]).includes(weekdayShort)
      ? (weekdayShort as DayKey)
      : null
    if (!dayKey) return true

    const window = getWorkingWindowForDayKey(dayKey, workingHours)
    if (!window) return true

    const startM = wallClock.hour * 60 + wallClock.minute
    const buf = clamp(Number(bufferMinutes) || 0, 0, 180)
    const endM = startM + computedDuration + buf

    return startM < window.startMinutes || endM > window.endMinutes
  }, [wallClock, workingHours, computedDuration, bufferMinutes, tz])

  const canSubmit = useMemo(() => {
    if (saving) return false
    if (!locationId) return false
    if (!selectedClient) return false
    if (!wallClock) return false
    if (!selectedServiceIds.length) return false
    // outside hours is allowed, but must be explicitly acknowledged
    if (outsideHours && !allowOutsideHours) return false
    return true
  }, [saving, locationId, selectedClient, wallClock, selectedServiceIds.length, outsideHours, allowOutsideHours])

  async function createBooking() {
    if (saving) return

    if (!locationId) {
      setErr('Select a location first.')
      return
    }
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
    if (outsideHours && !allowOutsideHours) {
      setErr('This time is outside working hours. Check “Schedule anyway” to confirm.')
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

      const buf = clamp(Number(bufferMinutes) || 0, 0, 180)

      const payload = {
        clientId: selectedClient.id,
        scheduledFor: startUtc.toISOString(),

        // ✅ REQUIRED by schema + conflict checks
        locationId,
        locationType,

        serviceIds: selectedServiceIds,
        totalDurationMinutes: computedDuration,
        bufferMinutes: buf,
        internalNotes: internalNotes.trim() ? internalNotes.trim() : null,

        // ✅ Explicit pro-only override. Server can ignore if not implemented yet.
        allowOutsideWorkingHours: outsideHours ? true : false,
      }

      const res = await fetch('/api/pro/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data: unknown = await safeJson(res)
      if (!res.ok) throw new Error(errorFrom(data, 'Failed to create booking.'))

      const rec = isRecord(data) ? data : null
      const booking = rec && isRecord(rec.booking) ? (rec.booking as Record<string, unknown>) : null

      if (!booking) throw new Error('Malformed response: missing booking.') // ✅ add this

      const id = getString(booking.id) // ✅ now booking is non-null
      if (!id) throw new Error('Server did not return booking.id')

      onCreated({
        id,
        startsAt: getString(booking.scheduledFor) ?? startUtc.toISOString(),
        endsAt: getString(booking.endsAt) ?? startUtc.toISOString(),
        title: getString(booking.serviceName) ?? 'Appointment',
        clientName: getString(booking.clientName) ?? selectedClient.fullName,
        status: booking.status ?? 'ACCEPTED',
        durationMinutes: getNumber(booking.totalDurationMinutes) ?? computedDuration,
      })
      close()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create booking.'
      setErr(msg)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-1300 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div
  className="w-full max-w-720px overflow-hidden rounded-2xl border border-white/12 bg-black/30 shadow-2xl backdrop-blur-xl"
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
          {/* Location context (trust signal) */}
          <div className="mb-3 rounded-2xl border border-white/10 bg-bgSecondary/30 p-3 text-xs text-textSecondary">
            <div>
              Location: <span className="font-semibold text-textPrimary">{locationLabel || locationId}</span>
            </div>
            <div className="mt-1">
              Mode: <span className="font-semibold text-textPrimary">{locationType}</span> • TZ:{' '}
              <span className="font-semibold text-textPrimary">{tz}</span> • Step:{' '}
              <span className="font-semibold text-textPrimary">{step} min</span>
            </div>
          </div>

          {outsideHours && (
            <div className="mb-3 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
              <div className="font-extrabold">Outside working hours</div>
              <div className="mt-1 text-textSecondary">
                Pros can schedule outside working hours. Clients will not be able to book this time.
              </div>

              <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-textPrimary">
                <input
                  type="checkbox"
                  checked={allowOutsideHours}
                  onChange={(e) => setAllowOutsideHours(e.target.checked)}
                  disabled={saving}
                />
                Schedule anyway
              </label>
            </div>
          )}

          {err && <div className="mb-2 text-sm font-semibold text-toneDanger">{err}</div>}

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
                  disabled={saving}
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
                          disabled={saving}
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
                          disabled={saving}
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
                disabled={saving}
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-textSecondary">Time</div>
              <input
                type="time"
                step={step * 60}
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm"
                disabled={saving}
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
                        disabled={saving}
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
                disabled={saving}
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-textSecondary">Internal notes (pro-only)</div>
              <input
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Notes the client never sees…"
                className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm"
                disabled={saving}
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
              disabled={!canSubmit}
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