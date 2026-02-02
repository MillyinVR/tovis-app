// app/pro/calendar/_components/DayWeekGrid.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { CalendarEvent, ViewMode, WorkingHoursJson, EntityType } from '../_types'
import { minutesSinceMidnightInTimeZone, ymdInTimeZone } from '../_utils/date'
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

function stableYmdForVisibleDay(d: Date, timeZone: string) {
  return ymdInTimeZone(new Date(d.getTime() + MIDDAY_MS), timeZone)
}

export function DayWeekGrid(props: {
  view: ViewMode
  visibleDays: Date[]
  events: CalendarEvent[]
  workingHoursSalon: WorkingHoursJson
  workingHoursMobile: WorkingHoursJson
  activeLocationType?: 'SALON' | 'MOBILE'
  timeZone: string
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
    workingHoursSalon,
    workingHoursMobile,
    activeLocationType = 'SALON',
    timeZone: timeZoneRaw,
    onClickEvent,
    onCreateForClick,
    onDragStart,
    onDropOnDayColumn,
    onBeginResize,
    suppressClickRef,
    isBusy,
  } = props

  const tzCandidate = typeof timeZoneRaw === 'string' ? timeZoneRaw.trim() : ''
  const tzResolved = isValidIanaTimeZone(tzCandidate)
  const timeZone = tzResolved ? tzCandidate : 'UTC'

  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const scrollRef = useRef<HTMLDivElement | null>(null)

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

  const { todayYmd, nowMinutes } = useMemo(() => {
    const now = new Date()
    return {
      todayYmd: ymdInTimeZone(now, timeZone),
      nowMinutes: minutesSinceMidnightInTimeZone(now, timeZone),
    }
  }, [timeZone, tick])

  const nowTopPx = clamp(nowMinutes, 0, TOTAL_MINUTES - 1) * PX_PER_MINUTE

  const visibleYmds = useMemo(
    () => visibleDays.map((d) => stableYmdForVisibleDay(d, timeZone)),
    [visibleDays, timeZone],
  )

  const todayIsInView = useMemo(() => visibleYmds.includes(todayYmd), [visibleYmds, todayYmd])
  const showNow = tzResolved && todayIsInView

  const gridCols = useMemo(
    () => `var(--cal-time-col) repeat(${visibleDays.length}, minmax(0, 1fr))`,
    [visibleDays.length],
  )

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (!showNow) return
    el.scrollTop = Math.max(0, nowTopPx - 160)
  }, [showNow, nowTopPx])

  return (
    <CalendarShell
      scrollRef={scrollRef}
      gridCols={gridCols}
      overlay={<NowLineOverlay topPx={nowTopPx + headerH} show={showNow} />}
    >
      <div ref={headerRef} className="sticky top-0 z-[200]">
        {/* ✅ no extra bg wash here — DayHeaderRow handles its own surface */}
        <div className="backdrop-blur-md">
          <DayHeaderRow visibleDays={visibleDays} timeZone={timeZone} todayYmd={todayYmd} gridCols={gridCols} />
        </div>

        <div className="h-px bg-white/10" />

        {/* keep the shadow cue, but slightly lighter so it doesn’t gray the top */}
        <div className="h-2 bg-gradient-to-b from-black/18 to-transparent" />
      </div>

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
            workingHoursSalon={workingHoursSalon}
            workingHoursMobile={workingHoursMobile}
            activeLocationType={activeLocationType}
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
