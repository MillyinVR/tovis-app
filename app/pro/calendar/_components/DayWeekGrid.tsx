// app/pro/calendar/_components/DayWeekGrid.tsx
'use client'

import type { DragEvent } from 'react'
import type { CalendarEvent, ViewMode, WorkingHoursJson, EntityType } from '../_types'
import { ymdInTimeZone, minutesSinceMidnightInTimeZone } from '../_utils/date'
import {
  PX_PER_MINUTE,
  snapMinutes,
  isBlockedEvent,
  extractBlockId,
  computeDurationMinutesFromIso,
} from '../_utils/calendarMath'
import { eventChipClassName } from '../_utils/statusStyles'
import { sanitizeTimeZone } from '@/lib/timeZone'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

type WorkingHoursDay = { enabled?: boolean; start?: string; end?: string }
type WorkingHours = Record<string, WorkingHoursDay>

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

function formatDayLabelInTimeZone(date: Date, timeZone: string) {
  // Example: "Mon, Feb 7"
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

/**
 * Hour label should represent wall-clock hours for the calendar day.
 * Using timeZone: 'UTC' prevents the browser timezone from shifting the label.
 */
function formatHourLabel(hour24: number) {
  const d = new Date(Date.UTC(2000, 0, 1, hour24, 0, 0))
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', hour: 'numeric' })
    .format(d)
    .replace(':00', '')
}

function weekdayKeyInTimeZone(date: Date, timeZone: string): keyof WorkingHours {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date).toLowerCase()
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

export function DayWeekGrid(props: {
  view: ViewMode
  visibleDays: Date[]
  events: CalendarEvent[]
  workingHours: WorkingHoursJson
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
    workingHours,
    timeZone: timeZoneRaw,
    onClickEvent,
    onCreateForClick,
    onDragStart,
    onDropOnDayColumn,
    onBeginResize,
    suppressClickRef,
    isBusy,
  } = props

  // ✅ Single source of truth for TZ in this component
  const timeZone = sanitizeTimeZone(timeZoneRaw, 'America/Los_Angeles') || 'America/Los_Angeles'

  const hours = Array.from({ length: 24 }, (_, h) => h)
  const totalMinutes = 24 * 60

  function eventDurationMinutes(ev: CalendarEvent) {
    if (Number.isFinite(ev.durationMinutes) && (ev.durationMinutes as number) > 0) {
      return Math.max(15, ev.durationMinutes as number)
    }
    return Math.max(15, computeDurationMinutesFromIso(ev.startsAt, ev.endsAt))
  }

  /**
   * Include any event that overlaps this day in the pro's timezone.
   * Not just events that start on that day.
   */
  function eventsForDay(day: Date) {
    const dayYmd = ymdInTimeZone(day, timeZone)

    return events.filter((ev) => {
      const sMs = new Date(ev.startsAt).getTime()
      const eMs = new Date(ev.endsAt).getTime()
      if (!Number.isFinite(sMs) || !Number.isFinite(eMs) || eMs <= sMs) return false

      const startYmd = ymdInTimeZone(new Date(sMs), timeZone)
      const endYmd = ymdInTimeZone(new Date(eMs - 1), timeZone) // avoid midnight “next day” edge

      return dayYmd >= startYmd && dayYmd <= endYmd
    })
  }

  function chipPrimary(ev: CalendarEvent) {
    if (isBlockedEvent(ev)) return 'Blocked'
    const name = (ev.clientName || '').trim()
    return name || 'Client'
  }

  function chipSecondary(ev: CalendarEvent) {
    if (isBlockedEvent(ev)) return (ev.note || ev.clientName || 'Personal time').toString()
    const svc = (ev.title || '').trim()
    return svc || 'Appointment'
  }

  const todayYmd = ymdInTimeZone(new Date(), timeZone)

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary">
      {/* header row */}
      <div
        className="grid border-b border-white/10 bg-bgSecondary"
        style={{ gridTemplateColumns: `80px repeat(${visibleDays.length}, 1fr)` }}
      >
        <div />
        {visibleDays.map((d, idx) => (
          <div
            key={idx}
            className="px-2 py-2 text-xs font-semibold text-textPrimary"
            style={{ borderLeft: idx === 0 ? undefined : '1px solid rgba(255,255,255,0.08)' }}
            title={timeZone}
          >
            {/* ✅ render header label in the passed TZ */}
            {formatDayLabelInTimeZone(d, timeZone)}
          </div>
        ))}
      </div>

      <div
        className="grid max-h-175 overflow-y-auto"
        style={{ gridTemplateColumns: `80px repeat(${visibleDays.length}, 1fr)` }}
      >
        {/* hour labels */}
        <div className="relative border-r border-white/10 bg-bgSecondary">
          <div className="relative" style={{ height: totalMinutes * PX_PER_MINUTE }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute left-2 text-xs text-textSecondary"
                style={{ top: h * 60 * PX_PER_MINUTE, height: 60 * PX_PER_MINUTE, paddingTop: 2 }}
              >
                {/* ✅ browser-proof label */}
                {formatHourLabel(h)}
              </div>
            ))}
          </div>
        </div>

        {/* day columns */}
        {visibleDays.map((day, dayIdx) => {
          const dayEvents = eventsForDay(day)

          const dayYmd = ymdInTimeZone(day, timeZone)
          const isToday = dayYmd === todayYmd

          const workingWindow = getWorkingWindowForDateInTimeZone(day, workingHours, timeZone)
          const dayEnabled = Boolean(workingWindow)

          return (
            <div
              key={dayIdx}
              className={['relative border-l border-white/10', isToday ? 'bg-bgPrimary' : 'bg-bgPrimary'].join(' ')}
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
              <div className="relative" style={{ height: totalMinutes * PX_PER_MINUTE }}>
                {/* working-hours shading */}
                {!dayEnabled && <div className="absolute inset-0 pointer-events-none bg-black/20" />}

                {dayEnabled && workingWindow && (
                  <>
                    {workingWindow.startMinutes > 0 && (
                      <div
                        className="absolute left-0 right-0 pointer-events-none bg-black/20"
                        style={{ top: 0, height: workingWindow.startMinutes * PX_PER_MINUTE }}
                      />
                    )}
                    {workingWindow.endMinutes < totalMinutes && (
                      <div
                        className="absolute left-0 right-0 pointer-events-none bg-black/20"
                        style={{
                          top: workingWindow.endMinutes * PX_PER_MINUTE,
                          height: (totalMinutes - workingWindow.endMinutes) * PX_PER_MINUTE,
                        }}
                      />
                    )}
                  </>
                )}

                {/* grid lines */}
                {Array.from({ length: 24 * 4 }, (_, i) => {
                  const minute = i * 15
                  const isHour = minute % 60 === 0
                  return (
                    <div
                      key={i}
                      className={isHour ? 'border-t border-white/10' : 'border-t border-white/5'}
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

                {/* events */}
                {dayEvents.map((ev) => {
                  const isBlock = isBlockedEvent(ev)
                  const entityType: EntityType = isBlock ? 'block' : 'booking'
                  const apiId = isBlock ? extractBlockId(ev) : ev.id

                  const dur = eventDurationMinutes(ev)

                  const evStart = new Date(ev.startsAt)
                  const evEnd = new Date(ev.endsAt)

                  const startYmd = ymdInTimeZone(evStart, timeZone)
                  const endYmd = ymdInTimeZone(new Date(evEnd.getTime() - 1), timeZone)

                  // clamp render to this day column
                  let startMinutes = 0
                  let endMinutes = 0

                  if (dayYmd === startYmd) startMinutes = minutesSinceMidnightInTimeZone(evStart, timeZone)
                  else startMinutes = 0

                  if (dayYmd === endYmd) endMinutes = minutesSinceMidnightInTimeZone(evEnd, timeZone)
                  else endMinutes = 24 * 60

                  if (endMinutes <= startMinutes) {
                    endMinutes = clamp(startMinutes + dur, startMinutes + 15, 24 * 60)
                  }

                  const heightMinutes = clamp(endMinutes - startMinutes, 15, 24 * 60)
                  const top = snapMinutes(startMinutes)

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
                        'absolute left-1 right-1 overflow-hidden rounded-2xl border p-3 text-left',
                        eventChipClassName(ev),
                      ].join(' ')}
                      style={{ top: top * PX_PER_MINUTE, height: heightMinutes * PX_PER_MINUTE }}
                      title={
                        isBlock
                          ? 'Drag to move, drag bottom to resize. Click to edit.'
                          : 'Drag to move, drag bottom to resize.'
                      }
                    >
                      {/* client */}
                      <div className="truncate text-xs font-extrabold leading-4">{chipPrimary(ev)}</div>

                      {/* service */}
                      <div className="truncate text-[11px] leading-4 text-textSecondary">{chipSecondary(ev)}</div>

                      {/* resize handle */}
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          if (!apiId) return
                          const rect = (e.currentTarget.parentElement as HTMLDivElement)
                            .parentElement!.getBoundingClientRect()

                          onBeginResize({
                            entityType,
                            eventId: ev.id,
                            apiId,
                            day,
                            startMinutes: top, // snapped top so resize math matches visuals
                            originalDuration: dur,
                            columnTop: rect.top,
                          })
                        }}
                        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize bg-black/10"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
