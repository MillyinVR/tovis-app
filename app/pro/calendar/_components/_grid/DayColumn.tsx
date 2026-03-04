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
} from '../../_utils/calendarMath'
import { useDayEvents } from './useDayEvents'
import { EventCard } from './EventCard'

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

function parseHHMM(v: string) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23) return null
  if (mm < 0 || mm > 59) return null
  return { hh, mm }
}

type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

function weekdayKeyInTimeZone(date: Date, timeZone: string): WeekdayKey {
  const tz = timeZone
  const safe = new Date(date.getTime() + MIDDAY_MS)
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
    .format(safe)
    .toLowerCase()

  if (wd.startsWith('mon')) return 'mon'
  if (wd.startsWith('tue')) return 'tue'
  if (wd.startsWith('wed')) return 'wed'
  if (wd.startsWith('thu')) return 'thu'
  if (wd.startsWith('fri')) return 'fri'
  if (wd.startsWith('sat')) return 'sat'
  return 'sun'
}

function getWorkingWindowForDateInTimeZone(day: Date, workingHours: WorkingHoursJson, timeZone: string): Window | null {
  if (!workingHours) return null

  const key = weekdayKeyInTimeZone(day, timeZone)
  const rule = workingHours[key]
  if (!rule || rule.enabled === false) return null

  const s = parseHHMM(rule.start)
  const e = parseHHMM(rule.end)
  if (!s || !e) return null

  const startMinutes = s.hh * 60 + s.mm
  const endMinutes = e.hh * 60 + e.mm
  if (endMinutes <= startMinutes) return null

  return { startMinutes, endMinutes }
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

function endMinutesForDay(args: { dayYmd: string; end: Date; timeZone: string }) {
  const { dayYmd, end, timeZone } = args
  const endYmdInclusive = ymdInTimeZone(new Date(end.getTime() - 1), timeZone)
  if (dayYmd !== endYmdInclusive) return null

  const endYmdExact = ymdInTimeZone(end, timeZone)
  const minutes = minutesSinceMidnightInTimeZone(end, timeZone)

  if (minutes === 0 && endYmdExact !== endYmdInclusive) return TOTAL_MINUTES
  return minutes
}

function formatTimeLabelFromMinutes(mins: number) {
  const hh = Math.floor(mins / 60)
  const mm = mins % 60
  const h12 = ((hh + 11) % 12) + 1
  const ampm = hh >= 12 ? 'PM' : 'AM'
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`
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

  const salonWindow = getWorkingWindowForDateInTimeZone(day, workingHoursSalon, timeZone)
  const mobileWindow = getWorkingWindowForDateInTimeZone(day, workingHoursMobile, timeZone)

  const mergedWorking = useMemo<Window[]>(() => {
    const list: Window[] = []
    if (salonWindow) list.push(salonWindow)
    if (mobileWindow) list.push(mobileWindow)
    return mergeWindows(list)
  }, [salonWindow?.startMinutes, salonWindow?.endMinutes, mobileWindow?.startMinutes, mobileWindow?.endMinutes])

  const dayEnabled = mergedWorking.length > 0

  const zebraWash = dayIdx % 2 === 1 ? 'bg-white/2' : 'bg-transparent'
  const leftBorder = dayIdx === 0 ? 'border-l-0' : 'border-l border-white/10'

  const outsideDim = 'bg-black/55'

  const salonFill = 'bg-amber-300/22'
  const salonEdge = 'border-amber-200/70'
  const salonSheen = 'bg-gradient-to-b from-white/10 via-transparent to-transparent'

  const mobileFill = 'bg-teal-400/18'
  const mobileEdge = 'border-teal-200/70'
  const mobileSheen = 'bg-gradient-to-r from-white/10 via-transparent to-transparent'

  const salonEdgeBoost = activeLocationType === 'SALON' ? 'border-amber-200/85' : salonEdge
  const mobileEdgeBoost = activeLocationType === 'MOBILE' ? 'border-teal-200/85' : mobileEdge

  function eventDurationMinutes(ev: CalendarEvent) {
    if (typeof ev.durationMinutes === 'number' && Number.isFinite(ev.durationMinutes) && ev.durationMinutes > 0) {
      return Math.max(15, ev.durationMinutes)
    }
    return Math.max(15, computeDurationMinutesFromIso(ev.startsAt, ev.endsAt))
  }

  const dayEvents = useDayEvents({ day, timeZone, events })
  const containerRef = useRef<HTMLDivElement | null>(null)
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
      <div className="relative" style={{ height: TOTAL_MINUTES * PX_PER_MINUTE }}>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/10" />
        <div className={['pointer-events-none absolute inset-0', zebraWash].join(' ')} />
        {isToday ? <div className="pointer-events-none absolute inset-0 bg-accentPrimary/8" /> : null}

        {/* grid lines */}
        {Array.from({ length: 24 * 4 }, (_, i) => {
          const minute = i * 15
          const isHour = minute % 60 === 0
          const isHalf = minute % 30 === 0
          const lineClass = isHour ? 'border-t border-white/12' : isHalf ? 'border-t border-white/7' : 'border-t border-white/5'

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

        {/* Non-working overlay */}
        {!dayEnabled ? (
          <div className={['pointer-events-none absolute inset-0', outsideDim].join(' ')} />
        ) : (
          <>
            {mergedWorking[0].startMinutes > 0 ? (
              <div
                className={['pointer-events-none absolute left-0 right-0', outsideDim].join(' ')}
                style={{ top: 0, height: mergedWorking[0].startMinutes * PX_PER_MINUTE }}
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
                      className={['pointer-events-none absolute left-0 right-0', outsideDim].join(' ')}
                      style={{ top: seg.endMinutes * PX_PER_MINUTE, height: gap * PX_PER_MINUTE }}
                    />
                  )
                })
              : null}

            {mergedWorking[mergedWorking.length - 1].endMinutes < TOTAL_MINUTES ? (
              <div
                className={['pointer-events-none absolute left-0 right-0', outsideDim].join(' ')}
                style={{
                  top: mergedWorking[mergedWorking.length - 1].endMinutes * PX_PER_MINUTE,
                  height: (TOTAL_MINUTES - mergedWorking[mergedWorking.length - 1].endMinutes) * PX_PER_MINUTE,
                }}
              />
            ) : null}
          </>
        )}

        {/* Working windows */}
        {salonWindow ? (
          <div
            className="pointer-events-none absolute left-0 right-0"
            style={{
              top: salonWindow.startMinutes * PX_PER_MINUTE,
              height: (salonWindow.endMinutes - salonWindow.startMinutes) * PX_PER_MINUTE,
            }}
          >
            <div className={['absolute inset-0', salonFill].join(' ')} />
            <div className={['absolute inset-0 opacity-70', salonSheen].join(' ')} />
            <div className={['absolute inset-x-0 top-0 border-t', salonEdgeBoost].join(' ')} />
            <div className={['absolute inset-x-0 bottom-0 border-t', salonEdgeBoost].join(' ')} />
          </div>
        ) : null}

        {mobileWindow ? (
          <div
            className="pointer-events-none absolute left-0 right-0"
            style={{
              top: mobileWindow.startMinutes * PX_PER_MINUTE,
              height: (mobileWindow.endMinutes - mobileWindow.startMinutes) * PX_PER_MINUTE,
            }}
          >
            <div className={['absolute inset-0', mobileFill].join(' ')} />
            <div className={['absolute inset-0 opacity-70', mobileSheen].join(' ')} />
            <div className={['absolute inset-x-0 top-0 border-t', mobileEdgeBoost].join(' ')} />
            <div className={['absolute inset-x-0 bottom-0 border-t', mobileEdgeBoost].join(' ')} />
          </div>
        ) : null}

        {/* events */}
        {dayEvents.map((ev: CalendarEvent) => {
          const isBlock = isBlockedEvent(ev)
          const entityType: EntityType = isBlock ? 'block' : 'booking'
          const apiId = isBlock ? extractBlockId(ev) : ev.id

          const dur =
            typeof ev.durationMinutes === 'number' && Number.isFinite(ev.durationMinutes) && ev.durationMinutes > 0
              ? Math.max(15, ev.durationMinutes)
              : Math.max(15, computeDurationMinutesFromIso(ev.startsAt, ev.endsAt))

          const evStart = new Date(ev.startsAt)
          const evEnd = new Date(ev.endsAt)

          const startYmd = ymdInTimeZone(evStart, timeZone)
          const endYmdInclusive = ymdInTimeZone(new Date(evEnd.getTime() - 1), timeZone)

          const startMinutesRaw = dayYmd === startYmd ? minutesSinceMidnightInTimeZone(evStart, timeZone) : 0
          const endMinutesRaw = dayYmd === endYmdInclusive ? minutesSinceMidnightInTimeZone(evEnd, timeZone) : 24 * 60

          const startMinutes = snapMinutes(startMinutesRaw)
          const safeEndMinutes = Math.max(startMinutes + 15, Math.min(24 * 60, endMinutesRaw <= startMinutesRaw ? startMinutesRaw + dur : endMinutesRaw))
          const heightMinutes = Math.max(15, safeEndMinutes - startMinutes)

          const topPx = startMinutes * PX_PER_MINUTE
          const heightPx = heightMinutes * PX_PER_MINUTE

          const micro = heightPx < 28
          const compact = heightPx < 52

          const tz = timeZone
          const timeLabel = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hour: 'numeric',
            minute: '2-digit',
          }).format(evStart)

          const rect = containerRef.current?.getBoundingClientRect()
          const columnTop = rect?.top ?? 0

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
              columnTop={columnTop}
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