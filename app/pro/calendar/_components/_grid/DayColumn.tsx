// app/pro/calendar/_components/_grid/DayColumn.tsx
'use client'

import { useMemo, useRef } from 'react'
import type { DragEvent, MutableRefObject } from 'react'

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

import { useDayEvents } from './useDayEvents'
import { EventCard } from './EventCard'

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
  emphasis: 'hour' | 'half' | 'quarter'
}

const MIDDAY_MS = 12 * 60 * 60 * 1000
const TOTAL_MINUTES = 24 * 60
const GRID_INTERVAL_MINUTES = 15
const MICRO_EVENT_HEIGHT_PX = 28
const COMPACT_EVENT_HEIGHT_PX = 52

const GRID_MARKS: GridMark[] = Array.from(
  { length: TOTAL_MINUTES / GRID_INTERVAL_MINUTES },
  (_, index) => {
    const minute = index * GRID_INTERVAL_MINUTES

    if (minute % 60 === 0) {
      return { minute, emphasis: 'hour' }
    }

    if (minute % 30 === 0) {
      return { minute, emphasis: 'half' }
    }

    return { minute, emphasis: 'quarter' }
  },
)

const WORKING_OVERLAY_CLASSES: Record<LocationType, string> = {
  SALON: [
    'bg-[var(--terra)]/10',
    'border-[var(--terra)]/35',
    'shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]',
  ].join(' '),
  MOBILE: [
    'bg-[var(--acid)]/10',
    'border-[var(--acid)]/25',
    'shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]',
  ].join(' '),
}

const ACTIVE_WORKING_OVERLAY_CLASSES: Record<LocationType, string> = {
  SALON: 'border-[var(--terra)]/65 bg-[var(--terra)]/14',
  MOBILE: 'border-[var(--acid)]/45 bg-[var(--acid)]/14',
}

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
    .filter((window) => window !== null)
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

function gridMarkClass(emphasis: GridMark['emphasis']) {
  if (emphasis === 'hour') return 'border-t border-[var(--paper)]/[0.12]'
  if (emphasis === 'half') return 'border-t border-[var(--paper)]/[0.07]'
  return 'border-t border-[var(--paper)]/[0.045]'
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
        .filter((item) => item.layout !== null),
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
      className={[
        'relative min-w-0',
        dayIdx === 0 ? 'border-l-0' : 'border-l border-[var(--line)]',
      ].join(' ')}
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
          className="pointer-events-none absolute inset-y-0 right-0 w-px bg-[var(--paper)]/[0.08]"
          aria-hidden="true"
        />

        <div
          className={[
            'pointer-events-none absolute inset-0',
            dayIdx % 2 === 1
              ? 'bg-[var(--paper)]/[0.018]'
              : 'bg-transparent',
          ].join(' ')}
          aria-hidden="true"
        />

        {isToday ? (
          <div
            className="pointer-events-none absolute inset-0 bg-[var(--terra)]/[0.055]"
            aria-hidden="true"
          />
        ) : null}

        {GRID_MARKS.map((mark) => (
          <div
            key={mark.minute}
            className={gridMarkClass(mark.emphasis)}
            style={{
              position: 'absolute',
              top: mark.minute * PX_PER_MINUTE,
              left: 0,
              right: 0,
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          />
        ))}

        {schedule.outsideHoursSegments.map((segment) => (
          <div
            key={segment.key}
            className={[
              'pointer-events-none absolute left-0 right-0',
              'bg-black/45 backdrop-blur-[1px]',
            ].join(' ')}
            style={{
              top: segment.startMinutes * PX_PER_MINUTE,
              height:
                (segment.endMinutes - segment.startMinutes) * PX_PER_MINUTE,
            }}
            aria-hidden="true"
          />
        ))}

        {schedule.overlays.map((overlay) => (
          <div
            key={overlay.locationType}
            className="pointer-events-none absolute left-0 right-0 px-1"
            style={{
              top: overlay.startMinutes * PX_PER_MINUTE,
              height:
                (overlay.endMinutes - overlay.startMinutes) * PX_PER_MINUTE,
            }}
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

            <div className="absolute inset-x-1 top-0 h-10 rounded-t-xl bg-gradient-to-b from-white/[0.06] to-transparent" />
          </div>
        ))}

        {eventLayouts.map((item) => {
          const { event, layout } = item

          if (!layout) return null

          return (
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
          )
        })}
      </div>
    </div>
  )
}