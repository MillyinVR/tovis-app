// app/pro/calendar/_components/DayWeekGrid.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { CalendarEvent, ViewMode, WorkingHoursJson, EntityType } from '../_types'
import { ymdInTimeZone, minutesSinceMidnightInTimeZone } from '../_utils/date'
import {
  PX_PER_MINUTE,
  snapMinutes,
  isBlockedEvent,
  extractBlockId,
  computeDurationMinutesFromIso,
} from '../_utils/calendarMath'
import { eventChipClassName } from '../_utils/statusStyles'
import { sanitizeTimeZone } from '@/lib/timeZone'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

type LocationType = 'SALON' | 'MOBILE'
type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

function parseHHMM(v?: string) {
  if (!v || typeof v !== 'string') return null
  const m = /^(\d{2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23) return null
  if (mm < 0 || mm > 59) return null
  return { hh, mm }
}

function weekdayKeyInTimeZone(date: Date, timeZone: string): keyof WorkingHours {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
    .format(date)
    .toLowerCase()
  if (wd.startsWith('mon')) return 'mon'
  if (wd.startsWith('tue')) return 'tue'
  if (wd.startsWith('wed')) return 'wed'
  if (wd.startsWith('thu')) return 'thu'
  if (wd.startsWith('fri')) return 'fri'
  if (wd.startsWith('sat')) return 'sat'
  return 'sun'
}

function getWorkingWindowForDateInTimeZone(day: Date, workingHours: WorkingHoursJson, timeZone: string) {
  if (!workingHours || typeof workingHours !== 'object') return null
  const wh = workingHours as unknown as WorkingHours
  const key = weekdayKeyInTimeZone(day, timeZone)
  const rule = wh?.[key]
  if (!rule || rule.enabled === false) return null

  const s = parseHHMM(rule.start)
  const e = parseHHMM(rule.end)
  if (!s || !e) return null

  const startMinutes = s.hh * 60 + s.mm
  const endMinutes = e.hh * 60 + e.mm
  if (endMinutes <= startMinutes) return null

  return { startMinutes, endMinutes }
}

/** Hour labels represent wall-clock hours for calendar day; lock to UTC so browser TZ doesn’t shift. */
function formatHourLabel(hour24: number) {
  const d = new Date(Date.UTC(2000, 0, 1, hour24, 0, 0))
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', hour: 'numeric' })
    .format(d)
    .replace(':00', '')
}

function formatTimeInTz(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function dayHeaderParts(date: Date, timeZone: string) {
  const weekday = new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short' }).format(date)
  const day = new Intl.DateTimeFormat(undefined, { timeZone, day: 'numeric' }).format(date)
  return { weekday, day }
}

function CurrentTimeLine(props: { topPx: number }) {
  const { topPx } = props

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-[9999]"
      style={{
        top: topPx,
        height: 3,
        background: 'red',
      }}
    >
      <div className="absolute -top-2 left-2 text-xs text-red-400">
        NOW
      </div>
    </div>
  )
}


export function DayWeekGrid(props: {
  view: ViewMode
  visibleDays: Date[]
  events: CalendarEvent[]
  workingHours: WorkingHoursJson
  timeZone: string
  locationType?: LocationType
  onClickEvent: (id: string) => void
  onCreateForClick: (day: Date, clientY: number, columnTop: number) => void
  onDragStart: (ev: CalendarEvent, e: DragEvent<HTMLDivElement>) => void
  onDropOnDayColumn: (day: Date, clientY: number, columnTop: number) => void
  onBeginResize: (args: {
    entityType: EntityType
    eventId: string
    apiId: string
    day: Date
    startMinutes: number
    originalDuration: number
    columnTop: number
  }) => void
  suppressClickRef: React.MutableRefObject<boolean>
  isBusy: boolean
}) {
  const {
    visibleDays,
    events,
    workingHours,
    timeZone: timeZoneRaw,
    locationType = 'SALON',
    onClickEvent,
    onCreateForClick,
    onDragStart,
    onDropOnDayColumn,
    onBeginResize,
    suppressClickRef,
    isBusy,
  } = props

  const timeZone = sanitizeTimeZone(timeZoneRaw, 'America/Los_Angeles') || 'America/Los_Angeles'

  // Used to keep the "now" line fresh (and to update the scroll position *if needed*).
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const scrollRef = useRef<HTMLDivElement | null>(null)

  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => h), [])
  const totalMinutes = 24 * 60
  const todayYmd = ymdInTimeZone(new Date(), timeZone)

  const nowMinutes = minutesSinceMidnightInTimeZone(new Date(), timeZone)
  const nowTop = clamp(nowMinutes, 0, totalMinutes)
  const nowTopPx = nowTop * PX_PER_MINUTE

  // Scroll to "now" once on mount.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = Math.max(0, nowTopPx - 160)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function eventDurationMinutes(ev: CalendarEvent) {
    if (Number.isFinite(ev.durationMinutes) && (ev.durationMinutes as number) > 0) {
      return Math.max(15, ev.durationMinutes as number)
    }
    return Math.max(15, computeDurationMinutesFromIso(ev.startsAt, ev.endsAt))
  }

  function eventsForDay(day: Date) {
    const dayYmd = ymdInTimeZone(day, timeZone)
    return events.filter((ev) => {
      const sMs = new Date(ev.startsAt).getTime()
      const eMs = new Date(ev.endsAt).getTime()
      if (!Number.isFinite(sMs) || !Number.isFinite(eMs) || eMs <= sMs) return false

      const startYmd = ymdInTimeZone(new Date(sMs), timeZone)
      const endYmd = ymdInTimeZone(new Date(eMs - 1), timeZone)
      return dayYmd >= startYmd && dayYmd <= endYmd
    })
  }

  function chipPrimary(ev: CalendarEvent) {
    if (isBlockedEvent(ev)) return 'Blocked'
    const name = (ev.clientName || '').trim()
    return name || 'Client'
  }

  function chipSecondary(ev: CalendarEvent) {
    if (isBlockedEvent(ev)) return (ev.note || ev.clientName || 'Personal time').toString()
    const svc = (ev.title || '').trim()
    return svc || 'Appointment'
  }

  // subtle tint inside working window
  const hoursTint = locationType === 'MOBILE' ? 'bg-emerald-500/5' : 'bg-accentPrimary/5'
  const gridCols = `var(--cal-time-col) repeat(${visibleDays.length}, minmax(0, 1fr))`

  // touch tick so the now line updates without TS unused warning
  void tick

  return (
    <section
      className={[
        'overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary',
        '[--cal-time-col:56px] md:[--cal-time-col:80px]',
        'shadow-[0_12px_40px_rgb(0_0_0/0.35)]',
      ].join(' ')}
    >
      <div ref={scrollRef} className="max-h-175 overflow-y-auto">
        {/* Sticky header row */}
        <div
          className="sticky top-0 z-20 grid border-b border-white/10 bg-bgSecondary/80 backdrop-blur"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="h-16 border-r border-white/10" />

          {visibleDays.map((d, idx) => {
            const dayYmd = ymdInTimeZone(d, timeZone)
            const isToday = dayYmd === todayYmd
            const alt = idx % 2 === 1
            const p = dayHeaderParts(d, timeZone)

            return (
              <div
                key={idx}
                className={[
                  'relative h-16 min-w-0 border-l border-white/10',
                  alt ? 'bg-bgSecondary/20' : '',
                ].join(' ')}
              >
                {/* Today styling only (no "Today" text) */}
                {isToday && (
                  <>
                    <div className="pointer-events-none absolute inset-0 bg-accentPrimary/6" />
                    <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-accentPrimary/35" />
                  </>
                )}

                <div className="relative flex h-full w-full items-center justify-center px-1">
                  <div
                    className={[
                      'flex w-full max-w-[72px] flex-col items-center justify-center rounded-2xl border',
                      isToday
                        ? 'border-accentPrimary/45 bg-accentPrimary/14 ring-1 ring-accentPrimary/25'
                        : 'border-white/10 bg-bgPrimary/25',
                    ].join(' ')}
                  >
                    <div
                      className={[
                        'pt-1 text-[15px] font-black leading-none',
                        isToday ? 'text-accentPrimary' : 'text-textPrimary',
                      ].join(' ')}
                    >
                      {p.day}
                    </div>
                    <div
                      className={[
                        'pb-1 text-[11px] font-extrabold tracking-tight',
                        isToday ? 'text-textPrimary' : 'text-textSecondary',
                      ].join(' ')}
                    >
                      {p.weekday}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Body */}
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          {/* time gutter */}
          <div className="relative border-r border-white/10 bg-bgSecondary/55">
            <div className="relative" style={{ height: totalMinutes * PX_PER_MINUTE }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute left-2 text-[11px] font-semibold text-textSecondary"
                  style={{ top: h * 60 * PX_PER_MINUTE, height: 60 * PX_PER_MINUTE, paddingTop: 6 }}
                >
                  {formatHourLabel(h)}
                </div>
              ))}
            </div>
          </div>

          {/* day columns */}
          {visibleDays.map((day, dayIdx) => {
            const dayEvents = eventsForDay(day)
            const dayYmd = ymdInTimeZone(day, timeZone)
            const isToday = dayYmd === todayYmd
            const alt = dayIdx % 2 === 1

            const workingWindow = getWorkingWindowForDateInTimeZone(day, workingHours, timeZone)
            const dayEnabled = Boolean(workingWindow)

            return (
              <div
                key={dayIdx}
                className="relative min-w-0 border-l border-white/10 bg-bgPrimary"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                  void onDropOnDayColumn(day, e.clientY, rect.top)
                }}
                onMouseDown={(e) => {
                  if (isBusy) return
                  if (suppressClickRef.current) return
                  if (e.button !== 0) return

                  const el = e.target as HTMLElement
                  if (el.closest('[data-cal-event="1"]')) return

                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                  onCreateForClick(day, e.clientY, rect.top)
                }}
              >
                <div className="relative" style={{ height: totalMinutes * PX_PER_MINUTE }}>
                  {/* alternating column shading */}
                  <div
                    className={[
                      'absolute inset-0 pointer-events-none',
                      alt ? 'bg-bgSecondary/14' : 'bg-transparent',
                    ].join(' ')}
                  />

                  {/* Today column: hairline + very subtle wash */}
                  {isToday && (
                    <>
                      <div className="absolute inset-0 pointer-events-none bg-accentPrimary/4" />
                      <div className="absolute inset-y-0 left-0 pointer-events-none w-px bg-accentPrimary/30" />
                    </>
                  )}

                  {/* ✅ Current time line (ONLY in the body where the height is 24h) */}
                  {isToday && <CurrentTimeLine topPx={nowTopPx} />}

                  {/* working-hours shading */}
                  {!dayEnabled && <div className="absolute inset-0 pointer-events-none bg-bgSecondary/55" />}

                  {dayEnabled && workingWindow && (
                    <>
                      <div
                        className={['absolute left-0 right-0 pointer-events-none', hoursTint].join(' ')}
                        style={{
                          top: workingWindow.startMinutes * PX_PER_MINUTE,
                          height: (workingWindow.endMinutes - workingWindow.startMinutes) * PX_PER_MINUTE,
                        }}
                      />
                      {workingWindow.startMinutes > 0 && (
                        <div
                          className="absolute left-0 right-0 pointer-events-none bg-bgSecondary/55"
                          style={{ top: 0, height: workingWindow.startMinutes * PX_PER_MINUTE }}
                        />
                      )}
                      {workingWindow.endMinutes < totalMinutes && (
                        <div
                          className="absolute left-0 right-0 pointer-events-none bg-bgSecondary/55"
                          style={{
                            top: workingWindow.endMinutes * PX_PER_MINUTE,
                            height: (totalMinutes - workingWindow.endMinutes) * PX_PER_MINUTE,
                          }}
                        />
                      )}
                    </>
                  )}

                  {/* grid lines (Today slightly stronger for orientation) */}
                  {Array.from({ length: 24 * 4 }, (_, i) => {
                    const minute = i * 15
                    const isHour = minute % 60 === 0

                    const lineClass = isHour
                      ? isToday
                        ? 'border-t border-white/16'
                        : 'border-t border-white/10'
                      : isToday
                        ? 'border-t border-white/8'
                        : 'border-t border-white/5'

                    return (
                      <div
                        key={i}
                        className={lineClass}
                        style={{
                          position: 'absolute',
                          top: minute * PX_PER_MINUTE,
                          left: 0,
                          right: 0,
                          pointerEvents: 'none',
                        }}
                      />
                    )
                  })}

                  {/* events */}
                  {dayEvents.map((ev) => {
                    const isBlock = isBlockedEvent(ev)
                    const entityType: EntityType = isBlock ? 'block' : 'booking'
                    const apiId = isBlock ? extractBlockId(ev) : ev.id

                    const dur = eventDurationMinutes(ev)

                    const evStart = new Date(ev.startsAt)
                    const evEnd = new Date(ev.endsAt)

                    const startYmd = ymdInTimeZone(evStart, timeZone)
                    const endYmd = ymdInTimeZone(new Date(evEnd.getTime() - 1), timeZone)

                    let startMinutes = dayYmd === startYmd ? minutesSinceMidnightInTimeZone(evStart, timeZone) : 0
                    let endMinutes = dayYmd === endYmd ? minutesSinceMidnightInTimeZone(evEnd, timeZone) : 24 * 60

                    if (endMinutes <= startMinutes) {
                      endMinutes = clamp(startMinutes + dur, startMinutes + 15, 24 * 60)
                    }

                    const heightMinutes = clamp(endMinutes - startMinutes, 15, 24 * 60)
                    const top = snapMinutes(startMinutes)

                    const timeLabel = `${formatTimeInTz(evStart, timeZone)}–${formatTimeInTz(evEnd, timeZone)}`

                    return (
                      <div
                        key={ev.id}
                        data-cal-event="1"
                        draggable={Boolean(apiId)}
                        onDragStart={(e) => onDragStart(ev, e)}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          if (suppressClickRef.current) return
                          onClickEvent(ev.id)
                        }}
                        className={[
                          'absolute left-1 right-1 overflow-hidden rounded-2xl border',
                          'px-2.5 py-2 md:px-3 md:py-3',
                          'shadow-sm backdrop-blur-md',
                          'ring-1 ring-white/8',
                          'transition-transform duration-150 hover:scale-[1.01]',
                          eventChipClassName(ev),
                        ].join(' ')}
                        style={{ top: top * PX_PER_MINUTE, height: heightMinutes * PX_PER_MINUTE }}
                        title={
                          isBlock
                            ? 'Drag to move, drag bottom to resize. Click to edit.'
                            : 'Drag to move, drag bottom to resize.'
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 truncate text-[13px] font-extrabold leading-4 text-textPrimary">
                            {chipPrimary(ev)}
                          </div>
                          <div className="shrink-0 text-[11px] font-semibold text-textSecondary">{timeLabel}</div>
                        </div>

                        <div className="mt-0.5 truncate text-[12px] leading-4 text-textSecondary">
                          {chipSecondary(ev)}
                        </div>

                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            if (!apiId) return
                            const rect = (e.currentTarget.parentElement as HTMLDivElement).parentElement!.getBoundingClientRect()

                            onBeginResize({
                              entityType,
                              eventId: ev.id,
                              apiId,
                              day,
                              startMinutes: top,
                              originalDuration: dur,
                              columnTop: rect.top,
                            })
                          }}
                          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize bg-black/10"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
