// app/pro/calendar/_components/DayWeekGrid.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  DragEvent,
  MutableRefObject,
  RefObject,
} from 'react'

import type { BrandProCalendarCopy } from '@/lib/brand/types'
import type {
  CalendarEvent,
  EntityType,
  ViewMode,
  WorkingHoursJson,
} from '../_types'

import {
  clamp,
  minutesSinceMidnightInTimeZone,
  ymdInTimeZone,
} from '../_utils/date'

import { PX_PER_MINUTE } from '../_utils/calendarMath'
import { DEFAULT_TIME_ZONE, isValidIanaTimeZone } from '@/lib/timeZone'

import { DayColumn } from './_grid/DayColumn'
import { DayHeaderRow } from './_grid/DayHeaderRow'
import { NowLineOverlay } from './_grid/NowLineOverlay'
import { TimeGutter } from './_grid/TimeGutter'

// ─── Types ────────────────────────────────────────────────────────────────────

type DayWeekGridProps = {
  copy: BrandProCalendarCopy

  view: ViewMode
  visibleDays: Date[]
  events: CalendarEvent[]
  workingHoursSalon: WorkingHoursJson
  workingHoursMobile: WorkingHoursJson
  activeLocationType?: 'SALON' | 'MOBILE'
  stepMinutes: number
  timeZone: string
  onClickEvent: (id: string) => void
  onCreateForClick: (day: Date, clientY: number, columnTop: number) => void
  onDragStart: (event: CalendarEvent, dragEvent: DragEvent<HTMLDivElement>) => void
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
  suppressClickRef: MutableRefObject<boolean>
  isBusy: boolean
}

type ResolvedTimeZone = {
  value: string
  isValid: boolean
}

type NowSnapshot = {
  todayYmd: string
  nowMinutes: number
}

type MeasuredElementHeight = {
  ref: RefObject<HTMLDivElement | null>
  height: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIDDAY_MS = 12 * 60 * 60 * 1000
const TOTAL_MINUTES_IN_DAY = 24 * 60
const NOW_REFRESH_INTERVAL_MS = 30_000

const DAY_VIEW_COUNT = 1
const WEEK_VIEW_COUNT = 7

const PROTOTYPE_START_MINUTE = 8 * 60
const PROTOTYPE_END_MINUTE = 20 * 60

const TIME_COLUMN_WIDTH = 'var(--brand-pro-calendar-time-column, 64px)'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function formatNowLabel(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60) % 24
  const minute = Math.floor(totalMinutes % 60)
  const displayHour = hour24 > 12 ? hour24 - 12 : hour24 === 0 ? 12 : hour24
  const meridiem = hour24 >= 12 ? 'pm' : 'am'

  return `${displayHour}:${String(minute).padStart(2, '0')}${meridiem}`
}

function resolveCalendarTimeZone(rawTimeZone: string): ResolvedTimeZone {
  const candidate = rawTimeZone.trim()

  if (!candidate || !isValidIanaTimeZone(candidate)) {
    return {
      value: DEFAULT_TIME_ZONE,
      isValid: false,
    }
  }

  return {
    value: candidate,
    isValid: true,
  }
}

function getTimelineDays(view: ViewMode, visibleDays: Date[]): Date[] {
  if (view === 'day') return visibleDays.slice(0, DAY_VIEW_COUNT)
  if (view === 'week') return visibleDays.slice(0, WEEK_VIEW_COUNT)

  return []
}

function getGridColumns(dayCount: number): string {
  return `${TIME_COLUMN_WIDTH} repeat(${dayCount}, minmax(0, 1fr))`
}

function visibleDayYmd(day: Date, timeZone: string): string {
  return ymdInTimeZone(new Date(day.getTime() + MIDDAY_MS), timeZone)
}

function timelineGridStyle(gridCols: string): CSSProperties {
  return {
    gridTemplateColumns: gridCols,
  }
}

function initialScrollTopPx(): number {
  return PROTOTYPE_START_MINUTE * PX_PER_MINUTE
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useMeasuredElementHeight(): MeasuredElementHeight {
  const ref = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const measure = () => {
      setHeight(element.getBoundingClientRect().height)
    }

    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)

      return () => window.removeEventListener('resize', measure)
    }

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(element)

    return () => resizeObserver.disconnect()
  }, [])

  return { ref, height }
}

function useNowSnapshot(args: {
  timeZone: string
  enabled: boolean
}): NowSnapshot {
  const { timeZone, enabled } = args
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return

    const refresh = () => setTick((currentTick) => currentTick + 1)

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') refresh()
    }, NOW_REFRESH_INTERVAL_MS)

    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [enabled, timeZone])

  return useMemo(() => {
    const now = new Date()

    return {
      todayYmd: ymdInTimeZone(now, timeZone),
      nowMinutes: minutesSinceMidnightInTimeZone(now, timeZone),
    }
  }, [timeZone, tick])
}

function useInitialTimelineScroll(args: {
  scrollRef: RefObject<HTMLDivElement | null>
  enabled: boolean
  targetTopPx: number
  scrollKey: string
}): void {
  const { scrollRef, enabled, targetTopPx, scrollKey } = args
  const lastScrollKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (lastScrollKeyRef.current === scrollKey) return

    const scrollElement = scrollRef.current
    if (!scrollElement) return

    lastScrollKeyRef.current = scrollKey
    scrollElement.scrollTop = Math.max(0, targetTopPx)
  }, [enabled, scrollKey, scrollRef, targetTopPx])
}

// ─── Exported component ───────────────────────────────────────────────────────

export function DayWeekGrid(props: DayWeekGridProps) {
  const {
    copy,
    view,
    visibleDays,
    events,
    workingHoursSalon,
    workingHoursMobile,
    activeLocationType = 'SALON',
    stepMinutes,
    timeZone: rawTimeZone,
    onClickEvent,
    onCreateForClick,
    onDragStart,
    onDropOnDayColumn,
    onBeginResize,
    suppressClickRef,
    isBusy,
  } = props

  const isTimelineView = view === 'day' || view === 'week'

  const timelineDays = useMemo(
    () => getTimelineDays(view, visibleDays),
    [view, visibleDays],
  )

  const resolvedTimeZone = useMemo(
    () => resolveCalendarTimeZone(rawTimeZone),
    [rawTimeZone],
  )

  const timeZone = resolvedTimeZone.value
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const header = useMeasuredElementHeight()

  const { todayYmd, nowMinutes } = useNowSnapshot({
    timeZone,
    enabled: isTimelineView,
  })

  const visibleYmds = useMemo(
    () => timelineDays.map((day) => visibleDayYmd(day, timeZone)),
    [timelineDays, timeZone],
  )

  const todayIsInView = useMemo(
    () => visibleYmds.includes(todayYmd),
    [todayYmd, visibleYmds],
  )

  const showNowLine = resolvedTimeZone.isValid && todayIsInView

  const nowTopPx =
    clamp(nowMinutes, 0, TOTAL_MINUTES_IN_DAY - 1) * PX_PER_MINUTE

  const gridCols = useMemo(
    () => getGridColumns(timelineDays.length),
    [timelineDays.length],
  )

  const scrollKey = useMemo(
    () => `${timeZone}:${view}:${visibleYmds.join('|')}`,
    [timeZone, view, visibleYmds],
  )

  useInitialTimelineScroll({
    scrollRef,
    enabled: isTimelineView,
    targetTopPx: initialScrollTopPx(),
    scrollKey,
  })

  if (!isTimelineView || timelineDays.length === 0) {
    return null
  }

  return (
    <section
      className="brand-pro-calendar-timeline"
      data-calendar-shell="timeline"
      data-calendar-view={view}
      data-calendar-days-visible={timelineDays.length}
      data-calendar-time-zone-valid={resolvedTimeZone.isValid ? 'true' : 'false'}
      data-calendar-now-visible={showNowLine ? 'true' : 'false'}
      data-calendar-prototype-start-minute={PROTOTYPE_START_MINUTE}
      data-calendar-prototype-end-minute={PROTOTYPE_END_MINUTE}
    >
      <div
        ref={scrollRef}
        className="brand-pro-calendar-timeline-scroll"
        data-calendar-scroll="timeline"
      >
        <div
          className="brand-pro-calendar-timeline-surface"
          data-calendar-surface="timeline"
        >
          <div className="brand-pro-calendar-timeline-content-layer">
            <div
              ref={header.ref}
              className="brand-pro-calendar-timeline-header"
              data-calendar-header="timeline"
            >
              <DayHeaderRow
                visibleDays={timelineDays}
                timeZone={timeZone}
                todayYmd={todayYmd}
                gridCols={gridCols}
              />
            </div>

            <div
              className="brand-pro-calendar-timeline-grid"
              style={timelineGridStyle(gridCols)}
              data-calendar-grid="timeline"
              data-calendar-view={view}
            >
              <TimeGutter
                totalMinutes={TOTAL_MINUTES_IN_DAY}
                timeZone={timeZone}
              />

              {timelineDays.map((day, dayIdx) => {
                const dayKey = visibleDayYmd(day, timeZone)

                return (
                  <DayColumn
                    key={dayKey}
                    copy={copy}
                    day={day}
                    dayIdx={dayIdx}
                    visibleDaysCount={timelineDays.length}
                    timeZone={timeZone}
                    todayYmd={todayYmd}
                    events={events}
                    workingHoursSalon={workingHoursSalon}
                    workingHoursMobile={workingHoursMobile}
                    activeLocationType={activeLocationType}
                    stepMinutes={stepMinutes}
                    isBusy={isBusy}
                    suppressClickRef={suppressClickRef}
                    onClickEvent={onClickEvent}
                    onCreateForClick={onCreateForClick}
                    onDragStart={onDragStart}
                    onDropOnDayColumn={onDropOnDayColumn}
                    onBeginResize={onBeginResize}
                  />
                )
              })}
            </div>
          </div>

          <div
            className="brand-pro-calendar-timeline-now-layer"
            aria-hidden="true"
          >
            <NowLineOverlay
              topPx={nowTopPx + header.height}
              show={showNowLine}
              nowLabel={formatNowLabel(nowMinutes)}
            />
          </div>
        </div>
      </div>
    </section>
  )
}