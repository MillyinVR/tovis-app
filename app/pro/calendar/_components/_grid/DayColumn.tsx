// app/pro/calendar/_components/_grid/DayColumn.tsx
'use client'

import { useMemo } from 'react'
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
import { eventAccentBgClassName, eventCardClassName } from '../../_utils/statusStyles'
import { useDayEvents } from './useDayEvents'

type LocationType = 'SALON' | 'MOBILE'
type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

type Window = { startMinutes: number; endMinutes: number }

const MIDDAY_MS = 12 * 60 * 60 * 1000
const TOTAL_MINUTES = 24 * 60

function stableYmdForVisibleDay(d: Date, timeZone: string) {
  // anchor at noon to avoid edge weirdness around midnight + DST
  return ymdInTimeZone(new Date(d.getTime() + MIDDAY_MS), timeZone)
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function parseHHMM(v?: string) {
  if (!v || typeof v !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23) return null
  if (mm < 0 || mm > 59) return null
  return { hh, mm }
}

function weekdayKeyInTimeZone(date: Date, timeZone: string): keyof WorkingHours {
  const safe = new Date(date.getTime() + MIDDAY_MS)
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(safe).toLowerCase()
  if (wd.startsWith('mon')) return 'mon'
  if (wd.startsWith('tue')) return 'tue'
  if (wd.startsWith('wed')) return 'wed'
  if (wd.startsWith('thu')) return 'thu'
  if (wd.startsWith('fri')) return 'fri'
  if (wd.startsWith('sat')) return 'sat'
  return 'sun'
}

function getWorkingWindowForDateInTimeZone(day: Date, workingHours: WorkingHoursJson, timeZone: string): Window | null {
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

/**
 * Merge overlapping/adjacent working windows into a minimal set of segments.
 * This is what lets us correctly dim the “gap between” SALON and MOBILE windows.
 */
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

    // overlap or touch
    if (cur.startMinutes <= prev.endMinutes) {
      prev.endMinutes = Math.max(prev.endMinutes, cur.endMinutes)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

/**
 * When an event ends exactly at 00:00 and we render the previous day,
 * minutesSinceMidnightInTimeZone(end) returns 0, but we want 24:00 for that day.
 */
function endMinutesForDay(args: { dayYmd: string; end: Date; timeZone: string }) {
  const { dayYmd, end, timeZone } = args

  // inclusive day for end (subtract 1ms)
  const endYmdInclusive = ymdInTimeZone(new Date(end.getTime() - 1), timeZone)
  if (dayYmd !== endYmdInclusive) return null

  const endYmdExact = ymdInTimeZone(end, timeZone)
  const minutes = minutesSinceMidnightInTimeZone(end, timeZone)

  if (minutes === 0 && endYmdExact !== endYmdInclusive) return TOTAL_MINUTES
  return minutes
}

function primaryText(ev: CalendarEvent) {
  if (isBlockedEvent(ev)) return 'Blocked'
  const name = (ev.clientName || '').trim()
  return name || 'Client'
}

function secondaryText(ev: CalendarEvent) {
  if (isBlockedEvent(ev)) return (ev.note || ev.clientName || 'Personal time').toString()
  const svc = (ev.title || '').trim()
  return svc || 'Appointment'
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

  // ✅ ONE non-working color everywhere
  const outsideDim = 'bg-black/55'

  // ✅ Salon styling (gold)
  const salonFill = 'bg-amber-300/22'
  const salonEdge = 'border-amber-200/70'
  const salonSheen = 'bg-gradient-to-b from-white/10 via-transparent to-transparent'

  // ✅ Mobile styling (teal)
  const mobileFill = 'bg-teal-400/18'
  const mobileEdge = 'border-teal-200/70'
  const mobileSheen = 'bg-gradient-to-r from-white/10 via-transparent to-transparent'

  // slight “active mode” emphasis without hiding the other
  const salonEdgeBoost = activeLocationType === 'SALON' ? 'border-amber-200/85' : salonEdge
  const mobileEdgeBoost = activeLocationType === 'MOBILE' ? 'border-teal-200/85' : mobileEdge

  function eventDurationMinutes(ev: CalendarEvent) {
    if (Number.isFinite(ev.durationMinutes) && (ev.durationMinutes as number) > 0) {
      return Math.max(15, ev.durationMinutes as number)
    }
    return Math.max(15, computeDurationMinutesFromIso(ev.startsAt, ev.endsAt))
  }

  const dayEvents = useDayEvents({ day, timeZone, events })

  return (
    <div
      data-cal-col="1"
      className={['relative min-w-0', leftBorder].join(' ')}
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
      <div className="relative" style={{ height: TOTAL_MINUTES * PX_PER_MINUTE }}>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/10" />

        <div className={['pointer-events-none absolute inset-0', zebraWash].join(' ')} />

        {isToday ? <div className="pointer-events-none absolute inset-0 bg-accentPrimary/8" /> : null}

        {/* grid lines */}
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

        {/* ====== NON-WORKING OVERLAY (single consistent color) ====== */}
        {!dayEnabled ? (
          <div className={['pointer-events-none absolute inset-0', outsideDim].join(' ')} />
        ) : (
          <>
            {/* dim before first segment */}
            {mergedWorking[0].startMinutes > 0 ? (
              <div
                className={['pointer-events-none absolute left-0 right-0', outsideDim].join(' ')}
                style={{ top: 0, height: mergedWorking[0].startMinutes * PX_PER_MINUTE }}
              />
            ) : null}

            {/* dim between segments */}
            {mergedWorking.length > 1
              ? mergedWorking.slice(0, -1).map((seg: Window, idx: number) => {
                  const next = mergedWorking[idx + 1]
                  const gap = next.startMinutes - seg.endMinutes
                  if (gap <= 0) return null
                  return (
                    <div
                      key={`gap-${idx}`}
                      className={['pointer-events-none absolute left-0 right-0', outsideDim].join(' ')}
                      style={{
                        top: seg.endMinutes * PX_PER_MINUTE,
                        height: gap * PX_PER_MINUTE,
                      }}
                    />
                  )
                })
              : null}

            {/* dim after last segment */}
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

        {/* ====== WORKING WINDOWS (always show both if present) ====== */}
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
        {dayEvents.map((ev) => {
          const isBlock = isBlockedEvent(ev)
          const entityType: EntityType = isBlock ? 'block' : 'booking'
          const apiId = isBlock ? extractBlockId(ev) : ev.id

          const dur = eventDurationMinutes(ev)
          const evStart = new Date(ev.startsAt)
          const evEnd = new Date(ev.endsAt)

          const startYmd = ymdInTimeZone(evStart, timeZone)
          const endYmdInclusive = ymdInTimeZone(new Date(evEnd.getTime() - 1), timeZone)

          const startMinutes = dayYmd === startYmd ? minutesSinceMidnightInTimeZone(evStart, timeZone) : 0
          const maybeEndMinutes = endMinutesForDay({ dayYmd, end: evEnd, timeZone })
          const endMinutes = dayYmd === endYmdInclusive ? (maybeEndMinutes ?? TOTAL_MINUTES) : TOTAL_MINUTES

          const safeEndMinutes =
            endMinutes <= startMinutes ? clamp(startMinutes + dur, startMinutes + 15, TOTAL_MINUTES) : endMinutes

          const heightMinutes = clamp(safeEndMinutes - startMinutes, 15, TOTAL_MINUTES)
          const topMinutes = clamp(snapMinutes(startMinutes), 0, TOTAL_MINUTES - 15)

          const topPx = topMinutes * PX_PER_MINUTE
          const heightPx = heightMinutes * PX_PER_MINUTE

          const micro = heightPx < 28
          const compact = heightPx < 52

          const cardCls = eventCardClassName({ status: ev.status ?? null, isBlocked: isBlock })
          const accent = eventAccentBgClassName({ status: ev.status ?? null, isBlocked: isBlock })

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
                'absolute z-20 left-0.5 right-0.5 overflow-hidden',
                'rounded-lg border',
                'shadow-md shadow-black/20',
                'ring-1 ring-white/10',
                'backdrop-blur-[10px]',
                'transition-transform duration-150 md:hover:scale-[1.01] active:scale-[0.995]',
                cardCls,
              ].join(' ')}
              style={{ top: topPx, height: heightPx }}
              title={isBlock ? 'Drag to move, drag bottom to resize. Click to edit.' : 'Drag to move, drag bottom to resize.'}
            >
              <div className="pointer-events-none absolute inset-0 bg-bgPrimary/85" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-white/5" />
              <div className={['absolute inset-y-0 left-0 w-1', accent].join(' ')} />

              <div className={['relative h-full pl-2 pr-1.5', micro ? 'py-1' : 'py-1.5'].join(' ')}>
                <div
                  className={[
                    'font-semibold text-textPrimary',
                    'whitespace-normal break-words',
                    micro ? 'text-[11px] leading-3.5' : 'text-[11.5px] leading-3.5',
                  ].join(' ')}
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    overflow: 'hidden',
                  }}
                >
                  {primaryText(ev)}
                </div>

                {!micro ? (
                  <div
                    className={[
                      'mt-0.5 font-medium text-textPrimary/85',
                      'whitespace-normal break-words',
                      'text-[10.5px] leading-3.5',
                    ].join(' ')}
                    style={{
                      display: '-webkit-box',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: compact ? 1 : 2,
                      overflow: 'hidden',
                    }}
                  >
                    {secondaryText(ev)}
                  </div>
                ) : null}

                <div
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    if (!apiId) return

                    const colRect = (e.currentTarget.closest('[data-cal-col="1"]') as HTMLDivElement | null)?.getBoundingClientRect()
                    const columnTop = colRect?.top ?? 0

                    onBeginResize({
                      entityType,
                      eventId: ev.id,
                      apiId,
                      day,
                      startMinutes: topMinutes,
                      originalDuration: dur,
                      columnTop,
                    })
                  }}
                  className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize bg-white/5"
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
