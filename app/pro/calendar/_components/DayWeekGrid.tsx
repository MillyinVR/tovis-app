// app/pro/calendar/_components/DayWeekGrid.tsx

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { CalendarEvent, ViewMode, WorkingHoursJson, EntityType } from '../_types'
import { ymdInTimeZone, minutesSinceMidnightInTimeZone } from '../_utils/date'
import { PX_PER_MINUTE } from '../_utils/calendarMath'
import { isValidIanaTimeZone } from '@/lib/timeZone'

import { CalendarShell } from './_grid/CalendarShell'
import { DayHeaderRow } from './_grid/DayHeaderRow'
import { TimeGutter } from './_grid/TimeGutter'
import { DayColumn } from './_grid/DayColumn'
import { NowLineOverlay } from './_grid/NowLineOverlay'

const MIDDAY_MS = 12 * 60 * 60 * 1000
const TOTAL_MINUTES = 24 * 60

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

/**
 * ✅ Visible-day “key” should be stable even if the Date is midnight-ish.
 * Midday anchoring is ONLY for bucket dates like visibleDays.
 */
function stableYmdForVisibleDay(d: Date, timeZone: string) {
  return ymdInTimeZone(new Date(d.getTime() + MIDDAY_MS), timeZone)
}

function formatNowInTz(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(now)
}

function safeIso(d: Date) {
  try {
    return d.toISOString()
  } catch {
    return '(invalid date)'
  }
}

function fmtYmd(ymd: string) {
  return ymd || '(empty)'
}

type LocationType = 'SALON' | 'MOBILE'

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
    view,
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

  // ✅ Prefer strict validity. Fallback to UTC for rendering only.
  const tzCandidate = typeof timeZoneRaw === 'string' ? timeZoneRaw.trim() : ''
  const tzResolved = isValidIanaTimeZone(tzCandidate)
  const timeZone = tzResolved ? tzCandidate : 'UTC'

  // Rerender periodically so the now-line moves.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const scrollRef = useRef<HTMLDivElement | null>(null)

  /**
   * ✅ Sticky header height affects overlay positioning:
   * overlay topPx is in scroll container coordinates, but grid "minute 0"
   * starts BELOW the sticky header. So we measure the sticky header height
   * and offset the overlay by that amount.
   */
  const headerRef = useRef<HTMLDivElement | null>(null)
  const [headerH, setHeaderH] = useState(0)

  useEffect(() => {
    const el = headerRef.current
    if (!el) return

    const measure = () => setHeaderH(el.getBoundingClientRect().height)
    measure()

    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { now, todayYmd, nowMinutes } = useMemo(() => {
    const now = new Date()
    return {
      now,
      todayYmd: ymdInTimeZone(now, timeZone),
      nowMinutes: minutesSinceMidnightInTimeZone(now, timeZone),
    }
  }, [timeZone, tick])

  // Prevent edge-case clipping at 24:00
  const nowTopPx = clamp(nowMinutes, 0, TOTAL_MINUTES - 1) * PX_PER_MINUTE

  const visibleYmds = useMemo(
    () => visibleDays.map((d) => stableYmdForVisibleDay(d, timeZone)),
    [visibleDays, timeZone],
  )

  const todayIsInView = useMemo(() => visibleYmds.includes(todayYmd), [visibleYmds, todayYmd])
  const todayColIndex = useMemo(() => visibleYmds.findIndex((v) => v === todayYmd), [visibleYmds, todayYmd])

  const gridCols = useMemo(
    () => `var(--cal-time-col) repeat(${visibleDays.length}, minmax(0, 1fr))`,
    [visibleDays.length],
  )

  const showNow = tzResolved && todayIsInView

  // Scroll to “now” when TZ resolves and today is visible.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (!showNow) return
    el.scrollTop = Math.max(0, nowTopPx - 160)
  }, [showNow, nowTopPx])

  // Debug (keep — it’s good)
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return

    const visibleDebug = visibleDays.map((d, i) => {
      const iso = safeIso(d)
      const ymdStable = stableYmdForVisibleDay(d, timeZone)
      const ymdRaw = ymdInTimeZone(d, timeZone)
      const localStr = d.toString()
      const ms = d.getTime()
      return { i, iso, localStr, ms, ymdRaw: fmtYmd(ymdRaw), ymdStable: fmtYmd(ymdStable) }
    })

    console.groupCollapsed(
      `%c[DayWeekGrid Debug] view=${String(view)} showNow=${showNow} todayIsInView=${todayIsInView} tzResolved=${tzResolved}`,
      'color:#b9a7ff;font-weight:600;',
    )
    console.log('timeZoneRaw:', tzCandidate || '(empty)')
    console.log('timeZoneUsed:', timeZone)
    console.log('now:', safeIso(now), 'nowInTz:', formatNowInTz(now, timeZone))
    console.log('todayYmd:', fmtYmd(todayYmd), 'todayColIndex:', todayColIndex)
    console.log('nowMinutes:', nowMinutes, 'nowTopPx:', nowTopPx, 'headerH:', headerH, 'overlayTopPx:', nowTopPx + headerH)
    console.log('visibleYmds:', visibleYmds)
    console.table(visibleDebug)
    console.groupEnd()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tick,
    view,
    timeZone,
    tzResolved,
    showNow,
    todayYmd,
    todayIsInView,
    todayColIndex,
    nowMinutes,
    nowTopPx,
    headerH,
    visibleDays.length,
  ])

  return (
    <CalendarShell
      scrollRef={scrollRef}
      gridCols={gridCols}
      // ✅ offset overlay by sticky header height so “now” matches the grid
      overlay={<NowLineOverlay topPx={nowTopPx + headerH} show={showNow} />}
    >
      {/* ✅ Sticky header layer that ALWAYS sits above event cards */}
      <div ref={headerRef} className="sticky top-0 z-[200]">
        <div className="bg-bgPrimary/85 backdrop-blur-md">
          <DayHeaderRow visibleDays={visibleDays} timeZone={timeZone} todayYmd={todayYmd} gridCols={gridCols} />
        </div>

        {/* subtle divider/shadow so it feels separated */}
        <div className="h-px bg-white/10" />
        <div className="h-2 bg-gradient-to-b from-black/25 to-transparent" />
      </div>

      {/* grid body */}
      <div className="relative grid" style={{ gridTemplateColumns: gridCols }}>
        <TimeGutter totalMinutes={TOTAL_MINUTES} timeZone={timeZone} />

        {visibleDays.map((day, dayIdx) => (
          <DayColumn
            key={stableYmdForVisibleDay(day, timeZone)}
            day={day}
            dayIdx={dayIdx}
            visibleDaysCount={visibleDays.length}
            timeZone={timeZone}
            todayYmd={todayYmd}
            events={events}
            workingHours={workingHours}
            locationType={locationType}
            isBusy={isBusy}
            suppressClickRef={suppressClickRef}
            onClickEvent={onClickEvent}
            onCreateForClick={onCreateForClick}
            onDragStart={onDragStart}
            onDropOnDayColumn={onDropOnDayColumn}
            onBeginResize={onBeginResize}
          />
        ))}
      </div>
    </CalendarShell>
  )
}
