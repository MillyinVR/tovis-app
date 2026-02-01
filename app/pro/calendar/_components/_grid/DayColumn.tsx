// app/pro/calendar/_components/_grid/DayColumn.tsx
'use client'

import type React from 'react'
import type { DragEvent } from 'react'
import type { CalendarEvent, EntityType, WorkingHoursJson } from '../../_types'
import { ymdInTimeZone, minutesSinceMidnightInTimeZone } from '../../_utils/date'
import {
  PX_PER_MINUTE,
  snapMinutes,
  isBlockedEvent,
  extractBlockId,
  computeDurationMinutesFromIso,
} from '../../_utils/calendarMath'
import { eventCardClassName, eventAccentBgClassName } from '../../_utils/statusStyles'
import { useDayEvents } from './useDayEvents'

type LocationType = 'SALON' | 'MOBILE'
type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

const MIDDAY_MS = 12 * 60 * 60 * 1000
const TOTAL_MINUTES = 24 * 60

function stableYmdForVisibleDay(d: Date, timeZone: string) {
  return ymdInTimeZone(new Date(d.getTime() + MIDDAY_MS), timeZone)
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function parseHHMM(v?: string) {
  if (!v || typeof v !== 'string') return null
  const m = /^(\d{2}):(\d{2})$/.exec(v.trim())
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

function getWorkingWindowForDateInTimeZone(day: Date, workingHours: WorkingHoursJson, timeZone: string) {
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
 * ✅ When an event ends exactly at 00:00 and we render the previous day,
 * minutesSinceMidnightInTimeZone(end) returns 0, but we want 24:00 for that day.
 */
function endMinutesForDay(args: { dayYmd: string; end: Date; timeZone: string }) {
  const { dayYmd, end, timeZone } = args

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
  workingHours: WorkingHoursJson
  locationType: LocationType
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
    workingHours,
    locationType,
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

  const workingWindow = getWorkingWindowForDateInTimeZone(day, workingHours, timeZone)
  const dayEnabled = Boolean(workingWindow)

  const hoursTint = locationType === 'MOBILE' ? 'bg-toneInfo/6' : 'bg-accentPrimary/6'
  const zebraWash = dayIdx % 2 === 1 ? 'bg-surfaceGlass/3' : 'bg-transparent'
  const leftBorder = dayIdx === 0 ? 'border-l-0' : 'border-l border-white/8'

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
      className={['relative min-w-0 bg-bgPrimary', leftBorder].join(' ')}
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
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/6" />
        <div className={['pointer-events-none absolute inset-0', zebraWash].join(' ')} />
        {isToday && <div className="pointer-events-none absolute inset-0 bg-accentPrimary/7" />}
        {!dayEnabled && <div className="pointer-events-none absolute inset-0 bg-bgSecondary/60" />}

        {dayEnabled && workingWindow && (
          <>
            <div
              className={['pointer-events-none absolute left-0 right-0', hoursTint].join(' ')}
              style={{
                top: workingWindow.startMinutes * PX_PER_MINUTE,
                height: (workingWindow.endMinutes - workingWindow.startMinutes) * PX_PER_MINUTE,
              }}
            />
            {workingWindow.startMinutes > 0 && (
              <div
                className="pointer-events-none absolute left-0 right-0 bg-bgSecondary/55"
                style={{ top: 0, height: workingWindow.startMinutes * PX_PER_MINUTE }}
              />
            )}
            {workingWindow.endMinutes < TOTAL_MINUTES && (
              <div
                className="pointer-events-none absolute left-0 right-0 bg-bgSecondary/55"
                style={{
                  top: workingWindow.endMinutes * PX_PER_MINUTE,
                  height: (TOTAL_MINUTES - workingWindow.endMinutes) * PX_PER_MINUTE,
                }}
              />
            )}
          </>
        )}

        {Array.from({ length: 24 * 4 }, (_, i) => {
          const minute = i * 15
          const isHour = minute % 60 === 0
          const isHalf = minute % 30 === 0
          const lineClass = isHour
            ? 'border-t border-white/10'
            : isHalf
              ? 'border-t border-white/6'
              : 'border-t border-white/4'

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

          // Vagaro-ish readability rules
          const micro = heightPx < 28 // tiny: show client only
          const compact = heightPx < 52 // short: client + 1 line service

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
                'absolute z-20 left-[2px] right-[2px] overflow-hidden',
                'rounded-lg border',
                'shadow-md shadow-black/20',
                'ring-1 ring-white/8',
                'backdrop-blur-[10px]',
                'transition-transform duration-150 md:hover:scale-[1.01] active:scale-[0.995]',
                // status-driven border/ring ONLY
                cardCls,
              ].join(' ')}
              style={{ top: topPx, height: heightPx }}
              title={isBlock ? 'Drag to move, drag bottom to resize. Click to edit.' : 'Drag to move, drag bottom to resize.'}
            >
              {/* ✅ Readable base surface (do NOT tint the whole card) */}
              <div className="pointer-events-none absolute inset-0 bg-bgPrimary/85" />
              {/* subtle highlight so it doesn’t look flat */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-white/6" />

              {/* Left accent strip (status cue) */}
              <div className={['absolute inset-y-0 left-0 w-1', accent].join(' ')} />

              <div className={['relative h-full pl-2 pr-1.5', micro ? 'py-1' : 'py-1.5'].join(' ')}>
                {/* Client name: wrap + clamp (Vagaro behavior) */}
                <div
                  className={[
                    'font-semibold text-textPrimary',
                    'whitespace-normal break-words',
                    micro ? 'text-[11px] leading-3.5' : 'text-[11.5px] leading-3.5',
                  ].join(' ')}
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: micro ? 2 : 2,
                    overflow: 'hidden',
                  }}
                >
                  {primaryText(ev)}
                </div>

                {/* Service: also wrap + clamp */}
                {!micro && (
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
                )}

                {/* Resize handle */}
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
