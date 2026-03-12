// app/pro/calendar/_components/_grid/DayColumn.tsx
'use client'

import { useMemo, useRef } from 'react'
import type React from 'react'
import type { DragEvent } from 'react'
import type { CalendarEvent, EntityType, WorkingHoursJson } from '../../_types'
import { minutesSinceMidnightInTimeZone, ymdInTimeZone } from '../../_utils/date'
import {
  PX_PER_MINUTE,
  computeDurationMinutesFromIso,
  extractBlockId,
  isBlockedEvent,
  snapMinutes,
  roundDurationMinutes,
} from '../../_utils/calendarMath'
import { useDayEvents } from './useDayEvents'
import { EventCard } from './EventCard'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

type LocationType = 'SALON' | 'MOBILE'
type Window = { startMinutes: number; endMinutes: number }

const MIDDAY_MS = 12 * 60 * 60 * 1000
const TOTAL_MINUTES = 24 * 60

function stableYmdForVisibleDay(d: Date, timeZone: string) {
  return ymdInTimeZone(new Date(d.getTime() + MIDDAY_MS), timeZone)
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function getWorkingWindowForDateInTimeZone(
  day: Date,
  workingHours: WorkingHoursJson,
  timeZone: string,
): Window | null {
  const result = getWorkingWindowForDay(
    new Date(day.getTime() + MIDDAY_MS),
    workingHours,
    timeZone,
  )
  if (!result.ok) return null

  return {
    startMinutes: result.startMinutes,
    endMinutes: result.endMinutes,
  }
}

function mergeWindows(windows: Window[]): Window[] {
  const list = windows
    .map((w) => ({
      startMinutes: clamp(w.startMinutes, 0, TOTAL_MINUTES),
      endMinutes: clamp(w.endMinutes, 0, TOTAL_MINUTES),
    }))
    .filter((w) => w.endMinutes > w.startMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes)

  if (!list.length) return []

  const out: Window[] = [{ ...list[0] }]
  for (let i = 1; i < list.length; i++) {
    const prev = out[out.length - 1]
    const cur = list[i]
    if (cur.startMinutes <= prev.endMinutes) {
      prev.endMinutes = Math.max(prev.endMinutes, cur.endMinutes)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

export function DayColumn(props: {
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
  suppressClickRef: React.MutableRefObject<boolean>
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
}) {
  const {
    day,
    dayIdx,
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

  const dayYmd = stableYmdForVisibleDay(day, timeZone)
  const isToday = dayYmd === todayYmd

  const salonWindow = getWorkingWindowForDateInTimeZone(
    day,
    workingHoursSalon,
    timeZone,
  )
  const mobileWindow = getWorkingWindowForDateInTimeZone(
    day,
    workingHoursMobile,
    timeZone,
  )

  const mergedWorking = useMemo<Window[]>(() => {
  const list: Window[] = []
  if (salonWindow) list.push(salonWindow)
  if (mobileWindow) list.push(mobileWindow)
  return mergeWindows(list)
}, [salonWindow, mobileWindow])

  const dayEnabled = mergedWorking.length > 0

  const zebraWash = dayIdx % 2 === 1 ? 'bg-white/2' : 'bg-transparent'
  const leftBorder = dayIdx === 0 ? 'border-l-0' : 'border-l border-white/10'

  const outsideDim = 'bg-black/55'

  const salonFill = 'bg-amber-300/22'
  const salonEdge = 'border-amber-200/70'
  const salonSheen =
    'bg-gradient-to-b from-white/10 via-transparent to-transparent'

  const mobileFill = 'bg-teal-400/18'
  const mobileEdge = 'border-teal-200/70'
  const mobileSheen =
    'bg-gradient-to-r from-white/10 via-transparent to-transparent'

  const salonEdgeBoost =
    activeLocationType === 'SALON' ? 'border-amber-200/85' : salonEdge
  const mobileEdgeBoost =
    activeLocationType === 'MOBILE' ? 'border-teal-200/85' : mobileEdge

  function eventDurationMinutes(ev: CalendarEvent, currentStepMinutes: number) {
    const raw =
      typeof ev.durationMinutes === 'number' &&
      Number.isFinite(ev.durationMinutes) &&
      ev.durationMinutes > 0
        ? ev.durationMinutes
        : computeDurationMinutesFromIso(ev.startsAt, ev.endsAt)

    return roundDurationMinutes(raw, currentStepMinutes)
  }

  const dayEvents = useDayEvents({ day, timeZone, events })
  const containerRef = useRef<HTMLDivElement | null>(null)

  function getColumnTop() {
    return containerRef.current?.getBoundingClientRect().top ?? 0
  }

  return (
    <div
      ref={containerRef}
      data-cal-col="1"
      className={['relative min-w-0', leftBorder].join(' ')}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        void onDropOnDayColumn(day, e.clientY, rect.top)
      }}
      onMouseDown={(e) => {
        if (isBusy) return
        if (suppressClickRef.current) return
        if (e.button !== 0) return

        const target = e.target instanceof HTMLElement ? e.target : null
        if (target && target.closest('[data-cal-event="1"]')) return

        const rect = e.currentTarget.getBoundingClientRect()
        onCreateForClick(day, e.clientY, rect.top)
      }}
    >
      <div
        className="relative"
        style={{ height: TOTAL_MINUTES * PX_PER_MINUTE }}
      >
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/10" />
        <div
          className={['pointer-events-none absolute inset-0', zebraWash].join(
            ' ',
          )}
        />
        {isToday ? (
          <div className="pointer-events-none absolute inset-0 bg-accentPrimary/8" />
        ) : null}

        {Array.from({ length: 24 * 4 }, (_, i) => {
          const minute = i * 15
          const isHour = minute % 60 === 0
          const isHalf = minute % 30 === 0
          const lineClass = isHour
            ? 'border-t border-white/12'
            : isHalf
              ? 'border-t border-white/7'
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

        {!dayEnabled ? (
          <div
            className={['pointer-events-none absolute inset-0', outsideDim].join(
              ' ',
            )}
          />
        ) : (
          <>
            {mergedWorking[0].startMinutes > 0 ? (
              <div
                className={[
                  'pointer-events-none absolute left-0 right-0',
                  outsideDim,
                ].join(' ')}
                style={{
                  top: 0,
                  height: mergedWorking[0].startMinutes * PX_PER_MINUTE,
                }}
              />
            ) : null}

            {mergedWorking.length > 1
              ? mergedWorking.slice(0, -1).map((seg, idx) => {
                  const next = mergedWorking[idx + 1]
                  const gap = next.startMinutes - seg.endMinutes
                  if (gap <= 0) return null

                  return (
                    <div
                      key={`gap-${idx}`}
                      className={[
                        'pointer-events-none absolute left-0 right-0',
                        outsideDim,
                      ].join(' ')}
                      style={{
                        top: seg.endMinutes * PX_PER_MINUTE,
                        height: gap * PX_PER_MINUTE,
                      }}
                    />
                  )
                })
              : null}

            {mergedWorking[mergedWorking.length - 1].endMinutes <
            TOTAL_MINUTES ? (
              <div
                className={[
                  'pointer-events-none absolute left-0 right-0',
                  outsideDim,
                ].join(' ')}
                style={{
                  top:
                    mergedWorking[mergedWorking.length - 1].endMinutes *
                    PX_PER_MINUTE,
                  height:
                    (TOTAL_MINUTES -
                      mergedWorking[mergedWorking.length - 1].endMinutes) *
                    PX_PER_MINUTE,
                }}
              />
            ) : null}
          </>
        )}

        {salonWindow ? (
          <div
            className="pointer-events-none absolute left-0 right-0"
            style={{
              top: salonWindow.startMinutes * PX_PER_MINUTE,
              height:
                (salonWindow.endMinutes - salonWindow.startMinutes) *
                PX_PER_MINUTE,
            }}
          >
            <div className={['absolute inset-0', salonFill].join(' ')} />
            <div className={['absolute inset-0 opacity-70', salonSheen].join(' ')} />
            <div
              className={['absolute inset-x-0 top-0 border-t', salonEdgeBoost].join(
                ' ',
              )}
            />
            <div
              className={[
                'absolute inset-x-0 bottom-0 border-t',
                salonEdgeBoost,
              ].join(' ')}
            />
          </div>
        ) : null}

        {mobileWindow ? (
          <div
            className="pointer-events-none absolute left-0 right-0"
            style={{
              top: mobileWindow.startMinutes * PX_PER_MINUTE,
              height:
                (mobileWindow.endMinutes - mobileWindow.startMinutes) *
                PX_PER_MINUTE,
            }}
          >
            <div className={['absolute inset-0', mobileFill].join(' ')} />
            <div className={['absolute inset-0 opacity-70', mobileSheen].join(' ')} />
            <div
              className={[
                'absolute inset-x-0 top-0 border-t',
                mobileEdgeBoost,
              ].join(' ')}
            />
            <div
              className={[
                'absolute inset-x-0 bottom-0 border-t',
                mobileEdgeBoost,
              ].join(' ')}
            />
          </div>
        ) : null}

        {dayEvents.map((ev: CalendarEvent) => {
          const isBlock = isBlockedEvent(ev)
          const entityType: EntityType = isBlock ? 'block' : 'booking'
          const apiId = isBlock ? extractBlockId(ev) : ev.id

          const dur = eventDurationMinutes(ev, stepMinutes)
          const evStart = new Date(ev.startsAt)
          const evEnd = new Date(ev.endsAt)

          const startYmd = ymdInTimeZone(evStart, timeZone)
          const endYmdInclusive = ymdInTimeZone(
            new Date(evEnd.getTime() - 1),
            timeZone,
          )

          const startMinutesRaw =
            dayYmd === startYmd
              ? minutesSinceMidnightInTimeZone(evStart, timeZone)
              : 0

          const endMinutesRaw =
            dayYmd === endYmdInclusive
              ? minutesSinceMidnightInTimeZone(evEnd, timeZone)
              : 24 * 60

          const startMinutes = snapMinutes(startMinutesRaw, stepMinutes)
          const minEndMinutes = startMinutes + stepMinutes
          const naturalEndMinutes =
            endMinutesRaw <= startMinutesRaw ? startMinutesRaw + dur : endMinutesRaw
          const safeEndMinutes = Math.max(
            minEndMinutes,
            Math.min(24 * 60, naturalEndMinutes),
          )
          const heightMinutes = Math.max(stepMinutes, safeEndMinutes - startMinutes)

          const topPx = startMinutes * PX_PER_MINUTE
          const heightPx = heightMinutes * PX_PER_MINUTE

          const micro = heightPx < 28
          const compact = heightPx < 52

          const timeLabel = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: 'numeric',
            minute: '2-digit',
          }).format(evStart)

          return (
            <EventCard
              key={ev.id}
              ev={ev}
              entityType={entityType}
              apiId={apiId}
              topPx={topPx}
              heightPx={heightPx}
              timeLabel={timeLabel}
              compact={compact}
              micro={micro}
              day={day}
              startMinutes={startMinutes}
              originalDuration={dur}
              getColumnTop={getColumnTop}
              suppressClickRef={suppressClickRef}
              onClickEvent={onClickEvent}
              onDragStart={onDragStart}
              onBeginResize={onBeginResize}
            />
          )
        })}
      </div>
    </div>
  )
}