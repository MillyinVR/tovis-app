// app/pro/calendar/_components/DayWeekGrid.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  DragEvent,
  MutableRefObject,
  RefObject,
} from 'react'

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

import { DayHeaderRow } from './_grid/DayHeaderRow'
import { TimeGutter } from './_grid/TimeGutter'
import { DayColumn } from './_grid/DayColumn'
import { NowLineOverlay } from './_grid/NowLineOverlay'

// ─── Types ────────────────────────────────────────────────────────────────────

type DayWeekGridProps = {
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MIDDAY_MS = 12 * 60 * 60 * 1000
const TOTAL_MINUTES_IN_DAY = 24 * 60
const NOW_REFRESH_INTERVAL_MS = 30_000
const NOW_SCROLL_OFFSET_PX = 160
const DAY_VIEW_COUNT = 1
const WEEK_VIEW_COUNT = 7

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

function getTimelineDays(view: ViewMode, visibleDays: Date[]) {
  if (view === 'day') return visibleDays.slice(0, DAY_VIEW_COUNT)
  if (view === 'week') return visibleDays.slice(0, WEEK_VIEW_COUNT)

  return []
}

function getGridColumns(dayCount: number) {
  return `var(--cal-time-col) repeat(${dayCount}, minmax(0, 1fr))`
}

function visibleDayYmd(day: Date, timeZone: string) {
  return ymdInTimeZone(new Date(day.getTime() + MIDDAY_MS), timeZone)
}

function shellStyle(): CSSProperties {
  return {
    backgroundColor: 'rgb(var(--ink))',
    borderColor: 'rgb(var(--paper) / 0.12)',
  }
}

function surfaceStyle(): CSSProperties {
  return {
    backgroundColor: 'rgb(var(--ink))',
  }
}

function timelineGridStyle(gridCols: string): CSSProperties {
  return {
    gridTemplateColumns: gridCols,
  }
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useMeasuredElementHeight() {
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

function useAutoScrollToNow(args: {
  scrollRef: RefObject<HTMLDivElement | null>
  enabled: boolean
  nowTopPx: number
  scrollKey: string
}) {
  const { scrollRef, enabled, nowTopPx, scrollKey } = args
  const lastScrollKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (lastScrollKeyRef.current === scrollKey) return

    const scrollElement = scrollRef.current
    if (!scrollElement) return

    lastScrollKeyRef.current = scrollKey
    scrollElement.scrollTop = Math.max(0, nowTopPx - NOW_SCROLL_OFFSET_PX)
  }, [enabled, nowTopPx, scrollKey, scrollRef])
}

// ─── Exported component ───────────────────────────────────────────────────────

export function DayWeekGrid(props: DayWeekGridProps) {
  const {
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

  const timelineDays = useMemo(
    () => getTimelineDays(view, visibleDays),
    [view, visibleDays],
  )

  const resolvedTimeZone = useMemo(
    () => resolveCalendarTimeZone(rawTimeZone),
    [rawTimeZone],
  )

  const timeZone = resolvedTimeZone.value
  const isTimelineView = view === 'day' || view === 'week'
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

  useAutoScrollToNow({
    scrollRef,
    enabled: showNowLine,
    nowTopPx,
    scrollKey,
  })

  if (!isTimelineView || timelineDays.length === 0) {
    return null
  }

  return (
    <section
      className={[
        'relative overflow-hidden border-y',
        'md:rounded-[18px] md:border',
        'md:shadow-[0_28px_70px_rgb(0_0_0_/_0.42)]',
        '[--cal-time-col:32px] md:[--cal-time-col:72px]',
      ].join(' ')}
      style={shellStyle()}
      data-calendar-shell="1"
      data-calendar-view={view}
      data-calendar-days-visible={timelineDays.length}
    >
      <div
        ref={scrollRef}
        className={[
          'relative h-[calc(100dvh-17rem)] min-h-[430px]',
          'overflow-auto overscroll-contain scroll-smooth',
          'md:max-h-[calc(100vh-16rem)] md:min-h-[520px]',
          'looksNoScrollbar',
        ].join(' ')}
        data-calendar-scroll="1"
      >
        <div
          className="relative min-w-0"
          style={surfaceStyle()}
          data-calendar-surface="1"
        >
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
          >
            <div className="absolute inset-0 bg-black/[0.10]" />
            <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-paper/[0.025] to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/20 to-transparent" />
          </div>

          <div className="relative z-10">
            <div
              ref={header.ref}
              className="sticky top-0 z-[200]"
              data-calendar-header="1"
            >
              <DayHeaderRow
                visibleDays={timelineDays}
                timeZone={timeZone}
                todayYmd={todayYmd}
                gridCols={gridCols}
              />
            </div>

            <div
              className="relative grid"
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
            className="pointer-events-none absolute inset-0 z-50"
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