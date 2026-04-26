// app/pro/calendar/_components/_grid/DayColumn.tsx
'use client'

import { useMemo, useRef } from 'react'
import type { CSSProperties, DragEvent, MutableRefObject } from 'react'

import type { CalendarEvent, EntityType, WorkingHoursJson } from '../../_types'

import {
  clamp,
  minutesSinceMidnightInTimeZone,
  ymdInTimeZone,
} from '../../_utils/date'

import {
  PX_PER_MINUTE,
  computeDurationMinutesFromIso,
  extractBlockId,
  getWorkingWindowForDay,
  isBlockedEvent,
  roundDurationMinutes,
  snapMinutes,
} from '../../_utils/calendarMath'

import { EventCard } from './EventCard'
import { useDayEvents } from './useDayEvents'

// ─── Types ────────────────────────────────────────────────────────────────────

type LocationType = 'SALON' | 'MOBILE'

type TimeWindow = {
  startMinutes: number
  endMinutes: number
}

type WorkingOverlay = TimeWindow & {
  locationType: LocationType
  active: boolean
}

type OutsideHoursSegment = TimeWindow & {
  key: string
}

type EventLayout = {
  apiId: string | null
  entityType: EntityType
  startMinutes: number
  durationMinutes: number
  topPx: number
  heightPx: number
  compact: boolean
  micro: boolean
  timeLabel: string
}

type EventLayoutItem = {
  event: CalendarEvent
  layout: EventLayout
}

type DayColumnProps = {
  day: Date
  dayIdx: number
  visibleDaysCount: number
  timeZone: string
  todayYmd: string
  events: CalendarEvent[]

  workingHoursSalon: WorkingHoursJson
  workingHoursMobile: WorkingHoursJson
  activeLocationType?: LocationType
  stepMinutes: number

  isBusy: boolean
  suppressClickRef: MutableRefObject<boolean>
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
}

type GridMark = {
  minute: number
}

type ScheduleLayout = {
  overlays: WorkingOverlay[]
  outsideHoursSegments: OutsideHoursSegment[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIDDAY_MS = 12 * 60 * 60 * 1000
const TOTAL_MINUTES = 24 * 60
const GRID_INTERVAL_MINUTES = 60
const MICRO_EVENT_HEIGHT_PX = 28
const COMPACT_EVENT_HEIGHT_PX = 52

const GRID_MARKS: GridMark[] = Array.from(
  { length: TOTAL_MINUTES / GRID_INTERVAL_MINUTES },
  (_, index) => ({
    minute: index * GRID_INTERVAL_MINUTES,
  }),
)

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function stableYmdForVisibleDay(day: Date, timeZone: string): string {
  return ymdInTimeZone(new Date(day.getTime() + MIDDAY_MS), timeZone)
}

function anchoredDayForWorkingHours(day: Date): Date {
  return new Date(day.getTime() + MIDDAY_MS)
}

function getWorkingWindowForDate(args: {
  day: Date
  workingHours: WorkingHoursJson
  timeZone: string
}): TimeWindow | null {
  const result = getWorkingWindowForDay(
    anchoredDayForWorkingHours(args.day),
    args.workingHours,
    args.timeZone,
  )

  if (!result) return null

  return {
    startMinutes: result.startMinutes,
    endMinutes: result.endMinutes,
  }
}

function normalizeWindow(window: TimeWindow): TimeWindow | null {
  const startMinutes = clamp(window.startMinutes, 0, TOTAL_MINUTES)
  const endMinutes = clamp(window.endMinutes, 0, TOTAL_MINUTES)

  if (endMinutes <= startMinutes) return null

  return {
    startMinutes,
    endMinutes,
  }
}

function isTimeWindow(value: TimeWindow | null): value is TimeWindow {
  return value !== null
}

function mergeWindows(windows: TimeWindow[]): TimeWindow[] {
  const normalized = windows
    .map(normalizeWindow)
    .filter(isTimeWindow)
    .sort((first, second) => first.startMinutes - second.startMinutes)

  const firstWindow = normalized[0]

  if (!firstWindow) return []

  const merged: TimeWindow[] = [
    {
      startMinutes: firstWindow.startMinutes,
      endMinutes: firstWindow.endMinutes,
    },
  ]

  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index]

    if (!current) continue

    const previous = merged[merged.length - 1]

    if (!previous) {
      merged.push({
        startMinutes: current.startMinutes,
        endMinutes: current.endMinutes,
      })
      continue
    }

    if (current.startMinutes <= previous.endMinutes) {
      previous.endMinutes = Math.max(previous.endMinutes, current.endMinutes)
      continue
    }

    merged.push({
      startMinutes: current.startMinutes,
      endMinutes: current.endMinutes,
    })
  }

  return merged
}

function buildOutsideHoursSegments(
  workingWindows: TimeWindow[],
): OutsideHoursSegment[] {
  const firstWindow = workingWindows[0]

  if (!firstWindow) {
    return [
      {
        key: 'closed-all-day',
        startMinutes: 0,
        endMinutes: TOTAL_MINUTES,
      },
    ]
  }

  const segments: OutsideHoursSegment[] = []

  if (firstWindow.startMinutes > 0) {
    segments.push({
      key: 'closed-before-open',
      startMinutes: 0,
      endMinutes: firstWindow.startMinutes,
    })
  }

  for (let index = 0; index < workingWindows.length - 1; index += 1) {
    const current = workingWindows[index]
    const next = workingWindows[index + 1]

    if (!current || !next) continue

    if (next.startMinutes > current.endMinutes) {
      segments.push({
        key: `closed-gap-${index}`,
        startMinutes: current.endMinutes,
        endMinutes: next.startMinutes,
      })
    }
  }

  const lastWindow = workingWindows[workingWindows.length - 1]

  if (lastWindow && lastWindow.endMinutes < TOTAL_MINUTES) {
    segments.push({
      key: 'closed-after-close',
      startMinutes: lastWindow.endMinutes,
      endMinutes: TOTAL_MINUTES,
    })
  }

  return segments
}

function getEventDurationMinutes(
  event: CalendarEvent,
  stepMinutes: number,
): number {
  const rawDuration =
    typeof event.durationMinutes === 'number' &&
    Number.isFinite(event.durationMinutes) &&
    event.durationMinutes > 0
      ? event.durationMinutes
      : computeDurationMinutesFromIso(event.startsAt, event.endsAt)

  return roundDurationMinutes(rawDuration, stepMinutes)
}

function eventApiId(event: CalendarEvent): string | null {
  if (isBlockedEvent(event)) return extractBlockId(event)

  return event.id
}

function eventEntityType(event: CalendarEvent): EntityType {
  return isBlockedEvent(event) ? 'block' : 'booking'
}

function isValidDate(date: Date): boolean {
  return Number.isFinite(date.getTime())
}

function buildEventLayout(args: {
  event: CalendarEvent
  dayYmd: string
  timeZone: string
  stepMinutes: number
  timeFormatter: Intl.DateTimeFormat
}): EventLayout | null {
  const { event, dayYmd, timeZone, stepMinutes, timeFormatter } = args

  const eventStart = new Date(event.startsAt)
  const eventEnd = new Date(event.endsAt)

  if (!isValidDate(eventStart)) return null

  const durationMinutes = getEventDurationMinutes(event, stepMinutes)
  const startYmd = ymdInTimeZone(eventStart, timeZone)

  const endYmdInclusive = isValidDate(eventEnd)
    ? ymdInTimeZone(new Date(eventEnd.getTime() - 1), timeZone)
    : startYmd

  const startMinutesRaw =
    dayYmd === startYmd
      ? minutesSinceMidnightInTimeZone(eventStart, timeZone)
      : 0

  const endMinutesRaw =
    dayYmd === endYmdInclusive && isValidDate(eventEnd)
      ? minutesSinceMidnightInTimeZone(eventEnd, timeZone)
      : TOTAL_MINUTES

  const startMinutes = snapMinutes(startMinutesRaw, stepMinutes)
  const minEndMinutes = startMinutes + stepMinutes

  const naturalEndMinutes =
    endMinutesRaw <= startMinutesRaw
      ? startMinutesRaw + durationMinutes
      : endMinutesRaw

  const safeEndMinutes = Math.max(
    minEndMinutes,
    Math.min(TOTAL_MINUTES, naturalEndMinutes),
  )

  const heightMinutes = Math.max(stepMinutes, safeEndMinutes - startMinutes)
  const topPx = startMinutes * PX_PER_MINUTE
  const heightPx = heightMinutes * PX_PER_MINUTE

  return {
    apiId: eventApiId(event),
    entityType: eventEntityType(event),
    startMinutes,
    durationMinutes,
    topPx,
    heightPx,
    compact: heightPx < COMPACT_EVENT_HEIGHT_PX,
    micro: heightPx < MICRO_EVENT_HEIGHT_PX,
    timeLabel: timeFormatter.format(eventStart),
  }
}

function buildScheduleLayout(args: {
  day: Date
  timeZone: string
  workingHoursSalon: WorkingHoursJson
  workingHoursMobile: WorkingHoursJson
  activeLocationType: LocationType
}): ScheduleLayout {
  const {
    day,
    timeZone,
    workingHoursSalon,
    workingHoursMobile,
    activeLocationType,
  } = args

  const salonWindow = getWorkingWindowForDate({
    day,
    workingHours: workingHoursSalon,
    timeZone,
  })

  const mobileWindow = getWorkingWindowForDate({
    day,
    workingHours: workingHoursMobile,
    timeZone,
  })

  const overlays: WorkingOverlay[] = []

  if (salonWindow) {
    overlays.push({
      ...salonWindow,
      locationType: 'SALON',
      active: activeLocationType === 'SALON',
    })
  }

  if (mobileWindow) {
    overlays.push({
      ...mobileWindow,
      locationType: 'MOBILE',
      active: activeLocationType === 'MOBILE',
    })
  }

  const mergedWorkingWindows = mergeWindows(overlays)
  const outsideHoursSegments = buildOutsideHoursSegments(mergedWorkingWindows)

  return {
    overlays,
    outsideHoursSegments,
  }
}

function timelineHeightStyle(): CSSProperties {
  return {
    height: TOTAL_MINUTES * PX_PER_MINUTE,
  }
}

function renderPositionStyle(
  startMinutes: number,
  endMinutes: number,
): CSSProperties {
  return {
    top: startMinutes * PX_PER_MINUTE,
    height: (endMinutes - startMinutes) * PX_PER_MINUTE,
  }
}

function dayParity(dayIdx: number): 'even' | 'odd' {
  return dayIdx % 2 === 0 ? 'even' : 'odd'
}

// ─── Exported component ───────────────────────────────────────────────────────

export function DayColumn(props: DayColumnProps) {
  const {
    day,
    dayIdx,
    visibleDaysCount,
    timeZone,
    todayYmd,
    events,
    workingHoursSalon,
    workingHoursMobile,
    activeLocationType = 'SALON',
    stepMinutes,
    isBusy,
    suppressClickRef,
    onClickEvent,
    onCreateForClick,
    onDragStart,
    onDropOnDayColumn,
    onBeginResize,
  } = props

  const containerRef = useRef<HTMLDivElement | null>(null)
  const dayYmd = stableYmdForVisibleDay(day, timeZone)
  const isToday = dayYmd === todayYmd
  const dayEvents = useDayEvents({ day, timeZone, events })

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
      }),
    [timeZone],
  )

  const schedule = useMemo(
    () =>
      buildScheduleLayout({
        day,
        timeZone,
        workingHoursSalon,
        workingHoursMobile,
        activeLocationType,
      }),
    [
      activeLocationType,
      day,
      timeZone,
      workingHoursMobile,
      workingHoursSalon,
    ],
  )

  const eventLayouts = useMemo(
    () =>
      dayEvents
        .map((event) => ({
          event,
          layout: buildEventLayout({
            event,
            dayYmd,
            timeZone,
            stepMinutes,
            timeFormatter,
          }),
        }))
        .filter((item): item is EventLayoutItem => item.layout !== null),
    [dayEvents, dayYmd, timeFormatter, timeZone, stepMinutes],
  )

  function getColumnTop(): number {
    return containerRef.current?.getBoundingClientRect().top ?? 0
  }

  return (
    <div
      ref={containerRef}
      className="brand-pro-calendar-day-column"
      data-cal-col="1"
      data-calendar-day={dayYmd}
      data-calendar-days-visible={visibleDaysCount}
      data-calendar-today={isToday ? 'true' : 'false'}
      data-day-index={dayIdx}
      data-day-parity={dayParity(dayIdx)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()

        const rect = event.currentTarget.getBoundingClientRect()
        onDropOnDayColumn(day, event.clientY, rect.top)
      }}
      onMouseDown={(event) => {
        if (isBusy) return
        if (suppressClickRef.current) return
        if (event.button !== 0) return

        const target = event.target instanceof Element ? event.target : null
        if (target?.closest('[data-cal-event="1"]')) return

        const rect = event.currentTarget.getBoundingClientRect()
        onCreateForClick(day, event.clientY, rect.top)
      }}
    >
      <div className="relative" style={timelineHeightStyle()}>
        {GRID_MARKS.map((mark) => (
          <div
            key={mark.minute}
            className="brand-pro-calendar-grid-mark"
            style={{ top: mark.minute * PX_PER_MINUTE }}
            data-today={isToday ? 'true' : 'false'}
            aria-hidden="true"
          />
        ))}

        {schedule.outsideHoursSegments.map((segment) => (
          <div
            key={segment.key}
            className="brand-pro-calendar-closed-hours pointer-events-none absolute left-0 right-0 hidden md:block"
            style={renderPositionStyle(segment.startMinutes, segment.endMinutes)}
            data-segment={segment.key}
            aria-hidden="true"
          />
        ))}

        {schedule.overlays.map((overlay) => (
          <div
            key={overlay.locationType}
            className="pointer-events-none absolute left-1 right-1 hidden md:block"
            style={renderPositionStyle(
              overlay.startMinutes,
              overlay.endMinutes,
            )}
            data-working-window-wrapper="true"
            data-location-type={overlay.locationType}
            data-active={overlay.active ? 'true' : 'false'}
            aria-hidden="true"
          >
            <div
              className="brand-pro-calendar-working-window"
              data-location-type={overlay.locationType}
              data-active={overlay.active ? 'true' : 'false'}
            />
          </div>
        ))}

        {eventLayouts.map(({ event, layout }) => (
          <EventCard
            key={event.id}
            ev={event}
            entityType={layout.entityType}
            apiId={layout.apiId}
            topPx={layout.topPx}
            heightPx={layout.heightPx}
            timeLabel={layout.timeLabel}
            compact={layout.compact}
            micro={layout.micro}
            day={day}
            startMinutes={layout.startMinutes}
            originalDuration={layout.durationMinutes}
            getColumnTop={getColumnTop}
            suppressClickRef={suppressClickRef}
            onClickEvent={onClickEvent}
            onDragStart={onDragStart}
            onDropOnDayColumn={onDropOnDayColumn}
            onBeginResize={onBeginResize}
          />
        ))}
      </div>
    </div>
  )
}