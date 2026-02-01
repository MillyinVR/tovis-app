// app/pro/calendar/_components/_grid/EventCard.tsx
'use client'

import type React from 'react'
import { eventChipClasses } from '../../_utils/statusStyles'
import type { CalendarEvent, EntityType } from '../../_types'

type Props = {
  ev: CalendarEvent
  isBlocked: boolean
  apiId: string | null
  entityType: EntityType
  topPx: number
  heightPx: number
  timeLabel: string
  compact: boolean
  micro: boolean

  suppressClickRef: React.MutableRefObject<boolean>
  onClickEvent: (id: string) => void
  onDragStart: (ev: CalendarEvent, e: React.DragEvent<HTMLDivElement>) => void
  onBeginResize: (args: {
    entityType: EntityType
    eventId: string
    apiId: string
    day: Date
    startMinutes: number
    originalDuration: number
    columnTop: number
  }) => void

  day: Date
  startMinutes: number
  originalDuration: number
  columnTop: number
}

function primaryText(ev: CalendarEvent, isBlocked: boolean) {
  if (isBlocked) return 'Blocked'
  const name = (ev.clientName || '').trim()
  return name || 'Client'
}

function secondaryText(ev: CalendarEvent, isBlocked: boolean) {
  if (isBlocked) return (ev.note || ev.clientName || 'Personal time').toString()
  const svc = (ev.title || '').trim()
  return svc || 'Appointment'
}

function accentFromStatus(status?: string | null, isBlocked?: boolean) {
  const s = String(status || '').toUpperCase()
  if (isBlocked || s === 'BLOCKED') return 'bg-white/18'
  if (s === 'PENDING' || s === 'RESCHEDULE_REQUESTED') return 'bg-toneWarn/55'
  if (s === 'CANCELLED' || s === 'DECLINED' || s === 'NO_SHOW') return 'bg-toneDanger/55'
  if (s === 'COMPLETED') return 'bg-toneSuccess/55'
  return 'bg-accentPrimary/55'
}

export function EventCard(props: Props) {
  const {
    ev,
    isBlocked,
    apiId,
    entityType,
    topPx,
    heightPx,
    timeLabel,
    compact,
    micro,
    suppressClickRef,
    onClickEvent,
    onDragStart,
    onBeginResize,
    day,
    startMinutes,
    originalDuration,
    columnTop,
  } = props

  const chip = eventChipClasses({ status: ev.status ?? null, isBlocked })
  const accent = accentFromStatus(ev.status ?? null, isBlocked)

  return (
    <div
      data-cal-event="1"
      draggable={Boolean(apiId)}
      onDragStart={(e) => onDragStart(ev, e)}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        if (suppressClickRef.current) return
        onClickEvent(ev.id)
      }}
      className={[
        'absolute z-20 left-1 right-1 overflow-hidden rounded-2xl border',
        'backdrop-blur-md',
        'shadow-xl shadow-black/35',
        'ring-1 ring-white/10',
        'transition-transform duration-150 md:hover:scale-[1.01] active:scale-[0.995]',
        chip.bg,
        chip.border,
        chip.ring || '',
      ].join(' ')}
      style={{ top: topPx, height: heightPx }}
    >
      {/* Accent strip */}
      <div className={['absolute inset-y-0 left-0 w-1.5', accent].join(' ')} />

      {/* Contrast layer */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-black/18 to-transparent" />

      <div className={['relative h-full pl-3 pr-2', micro ? 'py-1.5' : compact ? 'py-2' : 'py-2.5'].join(' ')}>
        <div className="flex items-start justify-between gap-2">
          <div
            className={[
              'min-w-0 font-semibold text-textPrimary',
              micro ? 'text-[12px] leading-4' : 'text-[13px] leading-4',
            ].join(' ')}
            style={{
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: micro ? 1 : 2,
              overflow: 'hidden',
            }}
          >
            {primaryText(ev, isBlocked)}
          </div>

          {!micro && (
            <div className="shrink-0 rounded-full bg-black/40 px-2 py-0.5 text-[11px] font-semibold text-white/90 ring-1 ring-white/10">
              {timeLabel}
            </div>
          )}
        </div>

        {!micro ? (
          <div
            className={[
              'mt-1 font-medium text-textPrimary/90',
              compact ? 'text-[12px] leading-4' : 'text-[12.5px] leading-4',
            ].join(' ')}
            style={{
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: compact ? 2 : 3,
              overflow: 'hidden',
            }}
          >
            {secondaryText(ev, isBlocked)}
          </div>
        ) : (
          <div className="mt-0.5 truncate text-[11px] font-medium text-textPrimary/85">
            {secondaryText(ev, isBlocked)}
          </div>
        )}

        {micro && <div className="mt-0.5 truncate text-[10px] font-semibold text-white/80">{timeLabel}</div>}

        {/* Resize handle */}
        <div
          onMouseDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (!apiId) return

            onBeginResize({
              entityType,
              eventId: ev.id,
              apiId,
              day,
              startMinutes,
              originalDuration,
              columnTop,
            })
          }}
          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize bg-white/5"
        />
      </div>
    </div>
  )
}
