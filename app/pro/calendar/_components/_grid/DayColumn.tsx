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

const WORKING_OVERLAY_CLASSES: Record<LocationType, string> = {
  SALON: 'border-terra/20 bg-terra/[0.025]',
  MOBILE: 'border-acid/20 bg-acid/[0.025]',
}

const ACTIVE_WORKING_OVERLAY_CLASSES: Record<LocationType, string> = {
  SALON: 'border-terra/35 bg-terra/[0.04]',
  MOBILE: 'border-acid/30 bg-acid/[0.04]',
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function stableYmdForVisibleDay(day: Date, timeZone: string) {
  return ymdInTimeZone(new Date(day.getTime() + MIDDAY_MS), timeZone)
}

function anchoredDayForWorkingHours(day: Date) {
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

function mergeWindows(windows: TimeWindow[]) {
  const normalized = windows
    .map(normalizeWindow)
    .filter((window): window is TimeWindow => window !== null)
    .sort((first, second) => first.startMinutes - second.startMinutes)

  if (normalized.length === 0) return []

  const merged: TimeWindow[] = [
    {
      startMinutes: normalized[0].startMinutes,
      endMinutes: normalized[0].endMinutes,
    },
  ]

  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index]
    const previous = merged[merged.length - 1]

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

function buildOutsideHoursSegments(workingWindows: TimeWindow[]) {
  if (workingWindows.length === 0) {
    return [
      {
        key: 'closed-all-day',
        startMinutes: 0,
        endMinutes: TOTAL_MINUTES,
      },
    ]
  }

  const segments: OutsideHoursSegment[] = []
  const firstWindow = workingWindows[0]

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

    if (next.startMinutes > current.endMinutes) {
      segments.push({
        key: `closed-gap-${index}`,
        startMinutes: current.endMinutes,
        endMinutes: next.startMinutes,
      })
    }
  }

  const lastWindow = workingWindows[workingWindows.length - 1]

  if (lastWindow.endMinutes < TOTAL_MINUTES) {
    segments.push({
      key: 'closed-after-close',
      startMinutes: lastWindow.endMinutes,
      endMinutes: TOTAL_MINUTES,
    })
  }

  return segments
}

function getEventDurationMinutes(event: CalendarEvent, stepMinutes: number) {
  const rawDuration =
    typeof event.durationMinutes === 'number' &&
    Number.isFinite(event.durationMinutes) &&
    event.durationMinutes > 0
      ? event.durationMinutes
      : computeDurationMinutesFromIso(event.startsAt, event.endsAt)

  return roundDurationMinutes(rawDuration, stepMinutes)
}

function eventApiId(event: CalendarEvent) {
  if (isBlockedEvent(event)) return extractBlockId(event)

  return event.id
}

function eventEntityType(event: CalendarEvent): EntityType {
  return isBlockedEvent(event) ? 'block' : 'booking'
}

function isValidDate(date: Date) {
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

function columnClassName(args: {
  dayIdx: number
  isToday: boolean
}) {
  const { dayIdx, isToday } = args

  return [
    'relative min-w-0',
    'border-l',
    dayIdx === 0 ? 'border-l-0' : '',
    isToday ? 'border-terra/45' : 'border-[var(--line)]',
  ].join(' ')
}

function columnStyle(args: {
  dayIdx: number
  isToday: boolean
}): CSSProperties {
  const { dayIdx, isToday } = args

  if (isToday) {
    return {
      backgroundColor: 'rgb(var(--terra) / 0.14)',
      boxShadow:
        'inset 1px 0 0 rgb(var(--terra) / 0.45), inset -1px 0 0 rgb(var(--terra) / 0.26)',
    }
  }

  if (dayIdx % 2 === 1) {
    return {
      backgroundColor: 'rgb(var(--paper) / 0.026)',
    }
  }

  return {
    backgroundColor: 'transparent',
  }
}

function gridMarkStyle(isToday: boolean): CSSProperties {
  return {
    borderColor: isToday
      ? 'rgb(var(--terra) / 0.16)'
      : 'rgb(var(--paper) / 0.04)',
  }
}

function sideRuleStyle(args: {
  side: 'left' | 'right'
  isToday: boolean
}): CSSProperties {
  const { side, isToday } = args

  if (!isToday) {
    return {
      backgroundColor: 'rgb(var(--paper) / 0.055)',
    }
  }

  return {
    backgroundColor:
      side === 'left'
        ? 'rgb(var(--terra) / 0.60)'
        : 'rgb(var(--terra) / 0.32)',
  }
}

function todayOverlayStyle(): CSSProperties {
  return {
    background:
      'linear-gradient(180deg, rgb(var(--terra) / 0.12) 0%, rgb(var(--terra) / 0.06) 42%, rgb(var(--terra) / 0.10) 100%)',
  }
}

function renderPositionStyle(startMinutes: number, endMinutes: number) {
  return {
    top: startMinutes * PX_PER_MINUTE,
    height: (endMinutes - startMinutes) * PX_PER_MINUTE,
  }
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

  const schedule = useMemo(() => {
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
  }, [
    activeLocationType,
    day,
    timeZone,
    workingHoursMobile,
    workingHoursSalon,
  ])

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

  function getColumnTop() {
    return containerRef.current?.getBoundingClientRect().top ?? 0
  }

  return (
    <div
      ref={containerRef}
      data-cal-col="1"
      data-calendar-day={dayYmd}
      data-calendar-days-visible={visibleDaysCount}
      data-calendar-today={isToday ? '1' : '0'}
      className={columnClassName({ dayIdx, isToday })}
      style={columnStyle({ dayIdx, isToday })}
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
      <div
        className="relative"
        style={{ height: TOTAL_MINUTES * PX_PER_MINUTE }}
      >
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-px"
          style={sideRuleStyle({ side: 'right', isToday })}
          aria-hidden="true"
        />

        {isToday ? (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-px"
              style={sideRuleStyle({ side: 'left', isToday })}
              aria-hidden="true"
            />

            <div
              className="pointer-events-none absolute inset-0"
              style={todayOverlayStyle()}
              aria-hidden="true"
            />
          </>
        ) : null}

        {GRID_MARKS.map((mark) => (
          <div
            key={mark.minute}
            className="pointer-events-none absolute left-0 right-0 border-t"
            style={{
              top: mark.minute * PX_PER_MINUTE,
              ...gridMarkStyle(isToday),
            }}
            aria-hidden="true"
          />
        ))}

        {schedule.outsideHoursSegments.map((segment) => (
          <div
            key={segment.key}
            className="pointer-events-none absolute left-0 right-0 hidden bg-black/[0.12] md:block"
            style={renderPositionStyle(segment.startMinutes, segment.endMinutes)}
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
            aria-hidden="true"
          >
            <div
              className={[
                'h-full rounded-xl border',
                WORKING_OVERLAY_CLASSES[overlay.locationType],
                overlay.active
                  ? ACTIVE_WORKING_OVERLAY_CLASSES[overlay.locationType]
                  : '',
              ].join(' ')}
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