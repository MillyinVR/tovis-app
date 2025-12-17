'use client'

import { useEffect, useState } from 'react'
import WorkingHoursForm from './WorkingHoursForm'

type CalendarEvent = {
  id: string
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  status: 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'
}

type ViewMode = 'day' | 'week' | 'month'

const PX_PER_MINUTE = 1 // 24h = 1440px column

type WorkingHoursJson = {
  [key: string]: {
    enabled: boolean
    start: string
    end: string
  }
} | null

type CalendarStats = {
  todaysBookings: number
  availableHours: number | null
  pendingRequests: number
  blockedHours: number | null
} | null

function startOfDay(d: Date) {
  const nd = new Date(d)
  nd.setHours(0, 0, 0, 0)
  return nd
}

function addDays(d: Date, days: number) {
  const nd = new Date(d)
  nd.setDate(nd.getDate() + days)
  return nd
}

function startOfWeek(d: Date) {
  const nd = startOfDay(d)
  const day = nd.getDay() // 0 = Sun
  const diff = (day + 6) % 7 // Monday start
  nd.setDate(nd.getDate() - diff)
  return nd
}

function startOfMonth(d: Date) {
  const nd = new Date(d.getFullYear(), d.getMonth(), 1)
  nd.setHours(0, 0, 0, 0)
  return nd
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatDayLabel(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatMonthRange(d: Date) {
  return d.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function formatWeekRange(d: Date) {
  const weekStart = startOfWeek(d)
  const weekEnd = addDays(weekStart, 6)
  const startStr = weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const endStr = weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${startStr} – ${endStr}`
}

// Map JS day index -> our workingHours keys
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function getWorkingWindowForDate(
  date: Date,
  workingHours: WorkingHoursJson,
): { startMinutes: number; endMinutes: number } | null {
  if (!workingHours) return null
  const key = DAY_KEYS[date.getDay()]
  const cfg = (workingHours as any)[key]
  if (!cfg || !cfg.enabled || !cfg.start || !cfg.end) return null

  const [sh, sm] = String(cfg.start).split(':').map((x: string) => parseInt(x, 10) || 0)
  const [eh, em] = String(cfg.end).split(':').map((x: string) => parseInt(x, 10) || 0)

  const startMinutes = sh * 60 + sm
  const endMinutes = eh * 60 + em

  if (endMinutes <= startMinutes) return null
  return { startMinutes, endMinutes }
}

export default function ProCalendarPage() {
  const [view, setView] = useState<ViewMode>('week')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [workingHours, setWorkingHours] = useState<WorkingHoursJson>(null)
  const [stats, setStats] = useState<CalendarStats>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHoursForm, setShowHoursForm] = useState(false)

  // ✅ Auto-accept state (this is what your TS errors were screaming about)
  const [autoAccept, setAutoAccept] = useState(false)
  const [savingAutoAccept, setSavingAutoAccept] = useState(false)

  async function toggleAutoAccept(next: boolean) {
    setAutoAccept(next) // optimistic UI
    setSavingAutoAccept(true)
    try {
      const res = await fetch('/api/pro/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoAcceptBookings: next }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save.')
      }

      setAutoAccept(Boolean(data?.professionalProfile?.autoAcceptBookings))
    } catch (e) {
      console.error(e)
      // rollback if save fails
      setAutoAccept((prev: boolean) => !prev)
    } finally {
      setSavingAutoAccept(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)

        const res = await fetch('/api/pro/calendar')
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data?.error || `Failed to load calendar (${res.status}).`)
          return
        }
        setEvents(data.events || [])
        setWorkingHours(data.workingHours || null)
        setStats(data.stats || null)

        // add this too so your toggle has initial state:
        setAutoAccept(Boolean(data.autoAcceptBookings))

      } catch (e) {
        console.error(e)
        if (!cancelled) setError('Network error loading calendar.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  // visible days
  let visibleDays: Date[] = []
  if (view === 'day') {
    visibleDays = [startOfDay(currentDate)]
  } else if (view === 'week') {
    const start = startOfWeek(currentDate)
    visibleDays = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  } else {
    const first = startOfMonth(currentDate)
    const firstWeekStart = startOfWeek(first)
    visibleDays = Array.from({ length: 42 }, (_, i) => addDays(firstWeekStart, i))
  }

  const hours = Array.from({ length: 24 }, (_, h) => h)

  function eventsForDay(day: Date) {
    return events.filter((ev) => {
      const start = new Date(ev.startsAt)
      return isSameDay(start, day)
    })
  }

  function handleToday() {
    setCurrentDate(new Date())
  }

  function handleBack() {
    if (view === 'day') setCurrentDate((d) => addDays(d, -1))
    else if (view === 'week') setCurrentDate((d) => addDays(d, -7))
    else setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, d.getDate()))
  }

  function handleNext() {
    if (view === 'day') setCurrentDate((d) => addDays(d, 1))
    else if (view === 'week') setCurrentDate((d) => addDays(d, 7))
    else setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()))
  }

  const headerLabel =
    view === 'month'
      ? formatMonthRange(currentDate)
      : view === 'week'
        ? formatWeekRange(currentDate)
        : currentDate.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: '40px auto',
        padding: '0 16px',
        fontFamily: 'system-ui',
      }}
    >
      {/* HEADER */}
      <header
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>Calendar</h1>
          <p style={{ fontSize: 13, color: '#555' }}>Visual overview of your day, week, or month.</p>
        </div>
        <a href="/pro" style={{ fontSize: 12, color: '#555', textDecoration: 'none' }}>
          ← Back to pro dashboard
        </a>
      </header>

      {/* CALENDAR MANAGEMENT STRIP */}
      <section
        style={{
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          background: '#111',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Calendar management</div>
            <div style={{ fontSize: 12, color: '#ddd' }}>Manage availability and appointments.</div>
          </div>

          <button
            type="button"
            onClick={() => setShowHoursForm((v) => !v)}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #fff',
              background: showHoursForm ? '#fff' : 'transparent',
              color: showHoursForm ? '#111' : '#fff',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {showHoursForm ? 'Hide schedule editor' : 'Edit working hours'}
          </button>
        </div>

        {/* Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 12,
            marginTop: 16,
          }}
        >
          <div style={{ borderRadius: 10, padding: 12, background: '#18181b', fontSize: 12 }}>
            <div style={{ marginBottom: 4, color: '#a1a1aa' }}>Today&apos;s bookings</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{stats?.todaysBookings ?? 0}</div>
          </div>

          <div style={{ borderRadius: 10, padding: 12, background: '#18181b', fontSize: 12 }}>
            <div style={{ marginBottom: 4, color: '#a1a1aa' }}>Available hours (today)</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{stats?.availableHours != null ? `${stats.availableHours}h` : '–'}</div>
          </div>

          <div style={{ borderRadius: 10, padding: 12, background: '#18181b', fontSize: 12 }}>
            <div style={{ marginBottom: 4, color: '#a1a1aa' }}>Pending requests</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{stats?.pendingRequests ?? 0}</div>
          </div>

          <div style={{ borderRadius: 10, padding: 12, background: '#18181b', fontSize: 12 }}>
            <div style={{ marginBottom: 4, color: '#a1a1aa' }}>Blocked time</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>
              {stats?.blockedHours != null ? `${stats.blockedHours}h` : '0h'}
              <span style={{ fontSize: 11, marginLeft: 4, color: '#a1a1aa' }}>(blocked slots later)</span>
            </div>
          </div>
        </div>

        {/* Auto-accept toggle */}
        <div
          style={{
            marginTop: 12,
            borderRadius: 10,
            padding: 12,
            background: '#18181b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Auto-accept bookings</div>
            <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 2 }}>
              When enabled, new client requests go straight to <b>Accepted</b>.
            </div>
          </div>

          <button
            type="button"
            onClick={() => toggleAutoAccept(!autoAccept)}
            disabled={savingAutoAccept}
            style={{
              padding: '8px 12px',
              borderRadius: 999,
              border: '1px solid #fff',
              background: autoAccept ? '#fff' : 'transparent',
              color: autoAccept ? '#111' : '#fff',
              fontSize: 12,
              fontWeight: 900,
              cursor: savingAutoAccept ? 'default' : 'pointer',
              opacity: savingAutoAccept ? 0.7 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {savingAutoAccept ? 'Saving…' : autoAccept ? 'On' : 'Off'}
          </button>
        </div>

        {/* Working hours form */}
        {showHoursForm && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: '#18181b' }}>
            <WorkingHoursForm
              initialHours={workingHours}
              onSaved={(next) => {
                setWorkingHours(next)
              }}
            />
          </div>
        )}
      </section>

      {/* Controls */}
      <section
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleToday}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #ddd',
              background: '#f9f9f9',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Today
          </button>
          <button
            type="button"
            onClick={handleBack}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #ddd',
              background: '#f9f9f9',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            ‹ Back
          </button>
          <button
            type="button"
            onClick={handleNext}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #ddd',
              background: '#f9f9f9',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Next ›
          </button>

          <div style={{ marginLeft: 12, fontSize: 14, fontWeight: 500 }}>{headerLabel}</div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              style={{
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid #ddd',
                fontSize: 12,
                cursor: 'pointer',
                background: view === mode ? '#111' : '#f9f9f9',
                color: view === mode ? '#fff' : '#111',
              }}
            >
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {loading && <div style={{ fontSize: 13, color: '#777', marginBottom: 8 }}>Loading…</div>}
      {error && <div style={{ fontSize: 13, color: 'red', marginBottom: 8 }}>{error}</div>}

      {/* DAY / WEEK VIEW */}
      {view === 'day' || view === 'week' ? (
        <section style={{ borderRadius: 12, border: '1px solid #eee', overflow: 'hidden', background: '#fff' }}>
          {/* Day headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `80px repeat(${visibleDays.length}, 1fr)`,
              borderBottom: '1px solid #eee',
              background: '#fafafa',
            }}
          >
            <div />
            {visibleDays.map((d, idx) => (
              <div
                key={idx}
                style={{
                  padding: '8px 6px',
                  borderLeft: idx === 0 ? 'none' : '1px solid #eee',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {formatDayLabel(d)}
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `80px repeat(${visibleDays.length}, 1fr)`,
              position: 'relative',
              maxHeight: 700,
              overflowY: 'auto',
            }}
          >
            {/* hour labels */}
            <div style={{ borderRight: '1px solid #eee', background: '#fafafa', position: 'relative' }}>
              <div style={{ position: 'relative', height: 24 * 60 * PX_PER_MINUTE }}>
                {hours.map((h) => (
                  <div
                    key={h}
                    style={{
                      position: 'absolute',
                      top: h * 60 * PX_PER_MINUTE,
                      height: 60 * PX_PER_MINUTE,
                      fontSize: 11,
                      color: '#777',
                      paddingTop: 2,
                      paddingLeft: 4,
                      boxSizing: 'border-box',
                    }}
                  >
                    {new Date(0, 0, 0, h)
                      .toLocaleTimeString(undefined, { hour: 'numeric', minute: undefined })
                      .replace(':00', '')}
                  </div>
                ))}
              </div>
            </div>

            {/* day columns */}
            {visibleDays.map((day, dayIdx) => {
              const dayEvents = eventsForDay(day)
              const totalMinutes = 24 * 60
              const isToday = isSameDay(day, new Date())
              const baseBg = dayIdx % 2 === 0 ? '#ffffff' : '#fafafa'

              const key = DAY_KEYS[day.getDay()]
              const dayConfig = workingHours && (workingHours as any)[key] ? (workingHours as any)[key] : null
              const dayEnabled = !!dayConfig?.enabled
              const workingWindow = dayEnabled ? getWorkingWindowForDate(day, workingHours) : null

              return (
                <div
                  key={dayIdx}
                  style={{
                    borderLeft: '1px solid #eee',
                    position: 'relative',
                    background: isToday ? '#fcfcff' : baseBg,
                  }}
                >
                  <div style={{ position: 'relative', height: totalMinutes * PX_PER_MINUTE }}>
                    {/* If the day is marked OFF, gray the whole column */}
                    {!dayEnabled && dayConfig && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          height: totalMinutes * PX_PER_MINUTE,
                          background: 'rgba(0,0,0,0.12)',
                          pointerEvents: 'none',
                        }}
                      />
                    )}

                    {/* If the day is ON, gray before/after working window */}
                    {dayEnabled && workingWindow && (
                      <>
                        {workingWindow.startMinutes > 0 && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              height: workingWindow.startMinutes * PX_PER_MINUTE,
                              background: 'rgba(0,0,0,0.10)',
                              pointerEvents: 'none',
                            }}
                          />
                        )}
                        {workingWindow.endMinutes < totalMinutes && (
                          <div
                            style={{
                              position: 'absolute',
                              top: workingWindow.endMinutes * PX_PER_MINUTE,
                              left: 0,
                              right: 0,
                              height: (totalMinutes - workingWindow.endMinutes) * PX_PER_MINUTE,
                              background: 'rgba(0,0,0,0.10)',
                              pointerEvents: 'none',
                            }}
                          />
                        )}
                      </>
                    )}

                    {/* 15-min grid lines */}
                    {Array.from({ length: 24 * 4 }, (_, i) => {
                      const minute = i * 15
                      const isHour = minute % 60 === 0
                      return (
                        <div
                          key={i}
                          style={{
                            position: 'absolute',
                            top: minute * PX_PER_MINUTE,
                            left: 0,
                            right: 0,
                            borderTop: `1px solid ${isHour ? '#eee' : 'rgba(238,238,238,0.6)'}`,
                            boxSizing: 'border-box',
                          }}
                        />
                      )
                    })}

                    {/* events */}
                    {dayEvents.map((ev) => {
                      const start = new Date(ev.startsAt)
                      const end = new Date(ev.endsAt)
                      const startMinutes = start.getHours() * 60 + start.getMinutes()
                      const endMinutes = end.getHours() * 60 + end.getMinutes()
                      const duration = Math.max(endMinutes - startMinutes, 15)

                      const bg =
                        ev.status === 'COMPLETED'
                          ? '#d1fae5'
                          : ev.status === 'ACCEPTED'
                            ? '#bfdbfe'
                            : ev.status === 'PENDING'
                              ? '#fef9c3'
                              : '#fee2e2'

                      const border =
                        ev.status === 'COMPLETED'
                          ? '#10b981'
                          : ev.status === 'ACCEPTED'
                            ? '#3b82f6'
                            : ev.status === 'PENDING'
                              ? '#eab308'
                              : '#ef4444'

                      return (
                        <div
                          key={ev.id}
                          style={{
                            position: 'absolute',
                            left: '6px',
                            right: '6px',
                            top: startMinutes * PX_PER_MINUTE,
                            height: duration * PX_PER_MINUTE,
                            borderRadius: 6,
                            background: bg,
                            border: `1px solid ${border}`,
                            padding: '4px 6px',
                            fontSize: 11,
                            boxSizing: 'border-box',
                            overflow: 'hidden',
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
                            {ev.title}
                          </div>
                          <div
                            style={{
                              whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis',
                              overflow: 'hidden',
                            }}
                          >
                            {ev.clientName}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* MONTH VIEW */}
      {view === 'month' ? (
        <section style={{ borderRadius: 12, border: '1px solid #eee', overflow: 'hidden', background: '#fff' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              borderBottom: '1px solid #eee',
              background: '#fafafa',
            }}
          >
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
              <div key={w} style={{ padding: '6px 8px', fontSize: 12, fontWeight: 500, textAlign: 'center' }}>
                {w}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: 110 }}>
            {visibleDays.map((day, idx) => {
              const inCurrentMonth = day.getMonth() === currentDate.getMonth()
              const dayEvents = eventsForDay(day)
              return (
                <div
                  key={idx}
                  style={{
                    borderRight: (idx + 1) % 7 === 0 ? 'none' : '1px solid #eee',
                    borderBottom: idx >= 35 ? 'none' : '1px solid #eee',
                    padding: 6,
                    fontSize: 11,
                    background: inCurrentMonth ? '#fff' : '#fafafa',
                    position: 'relative',
                  }}
                >
                  <div style={{ fontWeight: 600, color: inCurrentMonth ? '#111' : '#999', marginBottom: 4 }}>
                    {day.getDate()}
                  </div>
                  <div style={{ display: 'grid', gap: 2 }}>
                    {dayEvents.slice(0, 3).map((ev) => (
                      <div
                        key={ev.id}
                        style={{
                          borderRadius: 4,
                          padding: '2px 4px',
                          background: '#eef2ff',
                          fontSize: 10,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && <div style={{ fontSize: 10, color: '#555' }}>+{dayEvents.length - 3} more</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}
    </main>
  )
}
