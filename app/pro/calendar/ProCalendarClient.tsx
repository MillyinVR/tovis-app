'use client'

import { useEffect, useMemo, useState } from 'react'

type CalendarEvent = {
  id: string
  start: string // ISO
  durationMinutes: number
  serviceName: string
  clientName: string
  status: string
}

type Summary = {
  todayBookings: number
  pendingRequests: number
  availableMinutes: number
  blockedMinutes: number
}

type Props = {
  initialAnchorDateISO: string
}

type ViewMode = 'day' | 'week' | 'month'

type WorkingDayConfig = {
  enabled: boolean
  start: string // "HH:MM"
  end: string   // "HH:MM"
}

type WorkingHoursState = {
  mon: WorkingDayConfig
  tue: WorkingDayConfig
  wed: WorkingDayConfig
  thu: WorkingDayConfig
  fri: WorkingDayConfig
  sat: WorkingDayConfig
  sun: WorkingDayConfig
}

// 24-hour grid
const START_HOUR = 0
const END_HOUR = 24
const SLOT_MINUTES = 15
const ROW_HEIGHT = 18

function addDays(base: Date, days: number) {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function startOfWeekMonday(d: Date) {
  const x = startOfDay(d)
  const day = x.getDay() // 0 Sun, 1 Mon...
  const diff = day === 0 ? -6 : 1 - day
  x.setDate(x.getDate() + diff)
  return x
}

function monthMatrix(anchor: Date) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = new Date(first)
  const weekday = start.getDay() // 0 Sun
  start.setDate(start.getDate() - weekday)

  const weeks: Date[][] = []
  for (let w = 0; w < 6; w++) {
    const row: Date[] = []
    for (let d = 0; d < 7; d++) {
      row.push(new Date(start))
      start.setDate(start.getDate() + 1)
    }
    weeks.push(row)
  }
  return weeks
}

function formatDayLabel(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatTimeLabel(hour: number, minute: number) {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function groupEventsByDay(
  events: CalendarEvent[],
  baseDate: Date,
  dayCount: number,
) {
  const buckets: CalendarEvent[][] = Array(dayCount)
    .fill(null)
    .map(() => [])

  for (const ev of events) {
    const start = new Date(ev.start)
    const dayIndex = Math.floor(
      (start.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24),
    )
    if (dayIndex < 0 || dayIndex >= dayCount) continue
    buckets[dayIndex].push(ev)
  }
  return buckets
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export default function ProCalendarClient({ initialAnchorDateISO }: Props) {
  const [view, setView] = useState<ViewMode>('week')
  const [anchorDate, setAnchorDate] = useState<Date>(
    () => new Date(initialAnchorDateISO),
  )
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [workingHours, setWorkingHours] = useState<WorkingHoursState | null>(
    null,
  )
  const [workingHoursOpen, setWorkingHoursOpen] = useState(false)
  const [savingHours, setSavingHours] = useState(false)
  const [hoursError, setHoursError] = useState<string | null>(null)

  // Fetch events + summary when view or anchorDate changes
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(
          `/api/pro/calendar?view=${view}&date=${encodeURIComponent(
            anchorDate.toISOString(),
          )}`,
        )
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(data.error || 'Failed to load calendar.')
          setEvents([])
          setSummary(null)
          return
        }
        setEvents(data.events || [])
        setSummary(data.summary || null)
      } catch (err) {
        if (cancelled) return
        console.error(err)
        setError('Network error loading calendar.')
        setEvents([])
        setSummary(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [view, anchorDate])

  // Fetch working hours when the drawer first opens
  useEffect(() => {
    if (!workingHoursOpen || workingHours) return
    let cancelled = false

    async function loadHours() {
      try {
        setHoursError(null)
        const res = await fetch('/api/pro/working-hours')
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setHoursError(data.error || 'Failed to load working hours.')
          return
        }
        setWorkingHours(data.workingHours)
      } catch (err) {
        if (cancelled) return
        console.error(err)
        setHoursError('Network error loading working hours.')
      }
    }

    loadHours()
    return () => {
      cancelled = true
    }
  }, [workingHoursOpen, workingHours])

  // Time grid calculations
  const { baseDateForGrid, visibleDays, eventsByDay } = useMemo(() => {
    if (view === 'day') {
      const base = startOfDay(anchorDate)
      const days = [base]
      return {
        baseDateForGrid: base,
        visibleDays: days,
        eventsByDay: groupEventsByDay(events, base, 1),
      }
    }

    if (view === 'week') {
      const base = startOfWeekMonday(anchorDate)
      const days = Array.from({ length: 7 }, (_, i) => addDays(base, i))
      return {
        baseDateForGrid: base,
        visibleDays: days,
        eventsByDay: groupEventsByDay(events, base, 7),
      }
    }

    return {
      baseDateForGrid: startOfWeekMonday(anchorDate),
      visibleDays: [] as Date[],
      eventsByDay: [] as CalendarEvent[][],
    }
  }, [view, anchorDate, events])

  const rowsPerHour = 60 / SLOT_MINUTES
  const totalMinutes = (END_HOUR - START_HOUR) * 60
  const totalRows = (totalMinutes / SLOT_MINUTES) | 0
  const dayColumnHeight = totalRows * ROW_HEIGHT

  function getEventPosition(startISO: string, durationMinutes: number) {
    const start = new Date(startISO)
    const minutesFromStart =
      (start.getHours() - START_HOUR) * 60 + start.getMinutes()

    const clampedMinutes = Math.max(0, Math.min(minutesFromStart, totalMinutes))
    const top = (clampedMinutes / SLOT_MINUTES) * ROW_HEIGHT

    const minHeight = ROW_HEIGHT
    const height = Math.max(
      minHeight,
      (durationMinutes / SLOT_MINUTES) * ROW_HEIGHT,
    )

    return { top, height }
  }

  function shiftAnchor(delta: number) {
    const d = new Date(anchorDate)
    if (view === 'day') {
      d.setDate(d.getDate() + delta)
    } else if (view === 'week') {
      d.setDate(d.getDate() + 7 * delta)
    } else {
      d.setMonth(d.getMonth() + delta)
    }
    setAnchorDate(d)
  }

  function formattedRangeLabel() {
    if (view === 'day') {
      return anchorDate.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    }

    if (view === 'week') {
      const start = startOfWeekMonday(anchorDate)
      const end = addDays(start, 6)
      const sameMonth = start.getMonth() === end.getMonth()
      const sameYear = start.getFullYear() === end.getFullYear()

      const startStr = start.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: sameYear ? undefined : 'numeric',
      })
      const endStr = end.toLocaleDateString(undefined, {
        month: sameMonth ? undefined : 'short',
        day: 'numeric',
        year: 'numeric',
      })
      return `${startStr} – ${endStr}`
    }

    return anchorDate.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    })
  }

  // Month view data
  const monthWeeks = useMemo(
    () => (view === 'month' ? monthMatrix(anchorDate) : []),
    [view, anchorDate],
  )

  const monthEventsByDayKey = useMemo(() => {
    if (view !== 'month') return {}
    const map: Record<string, CalendarEvent[]> = {}
    for (const ev of events) {
      const d = new Date(ev.start)
      const key = d.toISOString().slice(0, 10)
      if (!map[key]) map[key] = []
      map[key].push(ev)
    }
    return map
  }, [view, events])

  // Working hours helpers
  function handleWorkingHoursChange(
    key: keyof WorkingHoursState,
    field: keyof WorkingDayConfig,
    value: string | boolean,
  ) {
    if (!workingHours) return
    setWorkingHours({
      ...workingHours,
      [key]: {
        ...workingHours[key],
        [field]: value,
      },
    })
  }

  async function saveWorkingHours() {
    if (!workingHours) return
    try {
      setSavingHours(true)
      setHoursError(null)
      const res = await fetch('/api/pro/working-hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingHours }),
      })
      const data = await res.json()
      if (!res.ok) {
        setHoursError(data.error || 'Failed to save working hours.')
        return
      }
      setWorkingHours(data.workingHours)
    } catch (err) {
      console.error(err)
      setHoursError('Network error saving working hours.')
    } finally {
      setSavingHours(false)
    }
  }

  function minutesToHoursLabel(minutes: number) {
    if (!minutes) return '0 hrs'
    const hrs = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (!mins) return `${hrs} hr${hrs === 1 ? '' : 's'}`
    return `${hrs}h ${mins}m`
  }

  return (
    <section>
      {/* BLACK HEADER SUMMARY BAR (Vagaro-style lite) */}
      <div
        style={{
          borderRadius: 16,
          padding: 16,
          marginBottom: 16,
          background: '#111',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                opacity: 0.85,
                marginBottom: 2,
              }}
            >
              Calendar management
            </div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              Manage hours, see bookings, and keep your day from turning feral.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setWorkingHoursOpen((v) => !v)}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                border: '1px solid #fff',
                fontSize: 12,
                background: 'transparent',
                color: '#fff',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>⚙</span>
              <span>Working hours</span>
            </button>
            <button
              type="button"
              // Block-time UI later
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                border: 'none',
                fontSize: 12,
                background: '#7c3aed',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              + Block time
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 12,
          }}
        >
          <SummaryCard
            label="Today's bookings"
            value={summary?.todayBookings ?? 0}
            icon="📅"
          />
          <SummaryCard
            label="Available hours"
            value={minutesToHoursLabel(summary?.availableMinutes ?? 0)}
            icon="⏱"
          />
          <SummaryCard
            label="Pending requests"
            value={summary?.pendingRequests ?? 0}
            icon="⚠"
          />
          <SummaryCard
            label="Blocked time"
            value={minutesToHoursLabel(summary?.blockedMinutes ?? 0)}
            icon="⛔"
          />
        </div>
      </div>

      {/* WORKING HOURS EDITOR */}
      {workingHoursOpen && (
        <div
          style={{
            borderRadius: 12,
            border: '1px solid #e3e3e3',
            padding: 12,
            marginBottom: 16,
            background: '#fff',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 8,
              gap: 8,
              alignItems: 'center',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  marginBottom: 2,
                }}
              >
                Weekly working hours
              </div>
              <div style={{ fontSize: 11, color: '#666' }}>
                These hours drive “available time” and future booking rules.
              </div>
            </div>
          </div>

          {hoursError && (
            <div style={{ fontSize: 12, color: 'red', marginBottom: 8 }}>
              {hoursError}
            </div>
          )}

          {!workingHours ? (
            <div style={{ fontSize: 12, color: '#777' }}>Loading hours…</div>
          ) : (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 70px 90px 90px',
                  gap: 8,
                  alignItems: 'center',
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                <div>Day</div>
                <div>Active</div>
                <div>Start</div>
                <div>End</div>
              </div>

              <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
                {WEEKDAY_KEYS.map((key, idx) => {
                  const fullKey =
                    key === 'sun'
                      ? 'sun'
                      : (key as keyof WorkingHoursState)
                  const label = WEEKDAY_LABELS[idx]
                  const config =
                    workingHours[fullKey as keyof WorkingHoursState]

                  return (
                    <div
                      key={key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '90px 70px 90px 90px',
                        gap: 8,
                        alignItems: 'center',
                        fontSize: 12,
                      }}
                    >
                      <div>{label}</div>
                      <div>
                        <input
                          type="checkbox"
                          checked={config.enabled}
                          onChange={(e) =>
                            handleWorkingHoursChange(
                              fullKey as keyof WorkingHoursState,
                              'enabled',
                              e.target.checked,
                            )
                          }
                        />
                      </div>
                      <div>
                        <input
                          type="time"
                          value={config.start}
                          onChange={(e) =>
                            handleWorkingHoursChange(
                              fullKey as keyof WorkingHoursState,
                              'start',
                              e.target.value,
                            )
                          }
                          style={{
                            width: '100%',
                            borderRadius: 6,
                            border: '1px solid #ddd',
                            padding: '4px 6px',
                            fontSize: 12,
                          }}
                        />
                      </div>
                      <div>
                        <input
                          type="time"
                          value={config.end}
                          onChange={(e) =>
                            handleWorkingHoursChange(
                              fullKey as keyof WorkingHoursState,
                              'end',
                              e.target.value,
                            )
                          }
                          style={{
                            width: '100%',
                            borderRadius: 6,
                            border: '1px solid #ddd',
                            padding: '4px 6px',
                            fontSize: 12,
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => setWorkingHoursOpen(false)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: '1px solid #ccc',
                    fontSize: 12,
                    background: '#f7f7f7',
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={saveWorkingHours}
                  disabled={savingHours}
                  style={{
                    padding: '4px 14px',
                    borderRadius: 999,
                    border: 'none',
                    fontSize: 12,
                    background: '#111',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  {savingHours ? 'Saving…' : 'Save hours'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Top controls: range + navigation + view switcher */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setAnchorDate(new Date())}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid #ddd',
              fontSize: 12,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shiftAnchor(-1)}
            style={{
              padding: '4px 8px',
              borderRadius: 999,
              border: '1px solid #ddd',
              fontSize: 12,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => shiftAnchor(1)}
            style={{
              padding: '4px 8px',
              borderRadius: 999,
              border: '1px solid #ddd',
              fontSize: 12,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            ›
          </button>
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              marginLeft: 4,
            }}
          >
            {formattedRangeLabel()}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                border:
                  view === mode ? '1px solid #111' : '1px solid #ddd',
                fontSize: 12,
                background: view === mode ? '#111' : '#fff',
                color: view === mode ? '#fff' : '#333',
                cursor: 'pointer',
              }}
            >
              {mode === 'day'
                ? 'Day'
                : mode === 'week'
                ? 'Week'
                : 'Month'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 8,
            fontSize: 12,
            color: 'red',
          }}
        >
          {error}
        </div>
      )}

      {view === 'month' ? (
        /* MONTH GRID */
        <div
          style={{
            borderRadius: 12,
            border: '1px solid #e3e3e3',
            overflow: 'hidden',
            background: '#fff',
          }}
        >
          {/* Weekday headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              borderBottom: '1px solid #eee',
              background: '#fafafa',
            }}
          >
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
              (label) => (
                <div
                  key={label}
                  style={{
                    padding: '6px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    textAlign: 'center',
                    color: '#555',
                  }}
                >
                  {label}
                </div>
              ),
            )}
          </div>

          {/* Weeks */}
          <div
            style={{
              display: 'grid',
              gridTemplateRows: 'repeat(6, minmax(80px, 1fr))',
            }}
          >
            {monthWeeks.map((week, wi) => (
              <div
                key={wi}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, 1fr)',
                  borderBottom:
                    wi === monthWeeks.length - 1
                      ? 'none'
                      : '1px solid #f0f0f0',
                }}
              >
                {week.map((day) => {
                  const key = day.toISOString().slice(0, 10)
                  const dayEvents = monthEventsByDayKey[key] || []
                  const isCurrentMonth =
                    day.getMonth() === anchorDate.getMonth()

                  return (
                    <div
                      key={key}
                      style={{
                        borderRight: '1px solid #f0f0f0',
                        padding: 6,
                        fontSize: 11,
                        background: isCurrentMonth ? '#fff' : '#fafafa',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 600,
                          marginBottom: 4,
                          color: isCurrentMonth ? '#111' : '#999',
                        }}
                      >
                        {day.getDate()}
                      </div>
                      {dayEvents.slice(0, 3).map((ev) => (
                        <div
                          key={ev.id}
                          style={{
                            fontSize: 10,
                            marginBottom: 2,
                            padding: '2px 4px',
                            borderRadius: 4,
                            background: '#fde2c5',
                            border: '1px solid #c97b1a',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {ev.clientName} • {ev.serviceName}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <div
                          style={{
                            fontSize: 10,
                            color: '#777',
                            marginTop: 2,
                          }}
                        >
                          +{dayEvents.length - 3} more
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* DAY / WEEK TIME GRID */
        <div
          style={{
            borderRadius: 12,
            border: '1px solid #e3e3e3',
            overflow: 'hidden',
            background: '#fafafa',
          }}
        >
          {/* Header row: time + days */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '64px repeat(' +
                visibleDays.length +
                ', 1fr)',
              borderBottom: '1px solid #e3e3e3',
              background: '#fff',
            }}
          >
            <div
              style={{
                padding: '8px 6px',
                fontSize: 11,
                color: '#777',
                borderRight: '1px solid #eee',
              }}
            >
              Time
            </div>
            {visibleDays.map((d) => (
              <div
                key={d.toISOString()}
                style={{
                  padding: '8px 6px',
                  fontSize: 12,
                  fontWeight: 600,
                  textAlign: 'center',
                  borderRight: '1px solid #f0f0f0',
                }}
              >
                {formatDayLabel(d)}
              </div>
            ))}
          </div>

          {/* Body */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                '64px repeat(' + visibleDays.length + ', 1fr)',
              maxHeight: 600,
              overflowY: 'auto',
              background: '#fdfdfd',
            }}
          >
            {/* Time column */}
            <div
              style={{
                borderRight: '1px solid #eee',
                position: 'relative',
              }}
            >
              <div style={{ position: 'relative', height: dayColumnHeight }}>
                {Array.from(
                  { length: END_HOUR - START_HOUR + 1 },
                  (_, i) => START_HOUR + i,
                ).map((hour) => (
                  <div
                    key={hour}
                    style={{
                      position: 'absolute',
                      top:
                        ((hour - START_HOUR) *
                          60 *
                          ROW_HEIGHT) /
                          SLOT_MINUTES -
                        7,
                      fontSize: 11,
                      color: '#777',
                      paddingLeft: 4,
                    }}
                  >
                    {formatTimeLabel(hour, 0)}
                  </div>
                ))}
              </div>
            </div>

            {/* Day columns */}
            {visibleDays.map((date, dayIndex) => {
              const dayEvents =
                eventsByDay[dayIndex] || []
              return (
                <div
                  key={date.toISOString()}
                  style={{
                    position: 'relative',
                    borderRight:
                      dayIndex < visibleDays.length - 1
                        ? '1px solid #f0f0f0'
                        : '1px solid transparent',
                    borderLeft: '1px solid #f9f9f9',
                    backgroundImage:
                      'linear-gradient(to bottom, #f2f2f2 1px, transparent 1px)',
                    backgroundSize: `100% ${
                      ROW_HEIGHT * rowsPerHour
                    }px`,
                  }}
                >
                  <div
                    style={{
                      position: 'relative',
                      height: dayColumnHeight,
                    }}
                  >
                    {dayEvents.map((ev) => {
                      const { top, height } = getEventPosition(
                        ev.start,
                        ev.durationMinutes,
                      )

                      const statusColor =
                        ev.status === 'COMPLETED'
                          ? '#d1f2d4'
                          : ev.status === 'CANCELLED'
                          ? '#f5d6d6'
                          : '#fde2c5'

                      const borderColor =
                        ev.status === 'COMPLETED'
                          ? '#3d8a46'
                          : ev.status === 'CANCELLED'
                          ? '#b94b4b'
                          : '#c97b1a'

                      return (
                        <div
                          key={ev.id}
                          style={{
                            position: 'absolute',
                            left: 4,
                            right: 4,
                            top,
                            height,
                            borderRadius: 6,
                            background: statusColor,
                            border: `1px solid ${borderColor}`,
                            padding: '4px 6px',
                            boxSizing: 'border-box',
                            fontSize: 11,
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              marginBottom: 2,
                              whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis',
                              overflow: 'hidden',
                            }}
                          >
                            {ev.clientName}
                          </div>
                          <div
                            style={{
                              whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis',
                              overflow: 'hidden',
                            }}
                          >
                            {ev.serviceName}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: '#555',
                              marginTop: 2,
                            }}
                          >
                            {ev.status}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loading && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: '#777',
          }}
        >
          Loading…
        </div>
      )}
    </section>
  )
}

function SummaryCard(props: {
  label: string
  value: string | number
  icon: string
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        padding: 10,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.12)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: 54,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: 'rgba(255,255,255,0.7)',
        }}
      >
        <span>{props.label}</span>
        <span>{props.icon}</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>
        {props.value}
      </div>
    </div>
  )
}
