// app/pro/calendar/_components/_grid/EventCard.tsx
'use client'

import type {
  CSSProperties,
  DragEvent,
  KeyboardEvent,
  MutableRefObject,
} from 'react'

import type { CalendarEvent, EntityType } from '../../_types'

import {
  calendarStatusMeta,
  eventAccentBgClassName,
  eventCardClasses,
} from '../../_utils/statusStyles'

// ─── Types ────────────────────────────────────────────────────────────────────

type BeginResizeArgs = {
  entityType: EntityType
  eventId: string
  apiId: string
  day: Date
  startMinutes: number
  originalDuration: number
  columnTop: number
}

type EventCardProps = {
  ev: CalendarEvent
  entityType: EntityType
  apiId: string | null

  topPx: number
  heightPx: number
  timeLabel: string
  compact: boolean
  micro: boolean

  day: Date
  startMinutes: number
  originalDuration: number
  getColumnTop: () => number

  suppressClickRef: MutableRefObject<boolean>
  onClickEvent: (id: string) => void
  onDragStart: (event: CalendarEvent, dragEvent: DragEvent<HTMLDivElement>) => void
  onDropOnDayColumn: (day: Date, clientY: number, columnTop: number) => void
  onBeginResize: (args: BeginResizeArgs) => void
}

type EventCardCopy = {
  primary: string
  secondary: string
  eyebrow: string
  status: string
}

type TextClampOptions = {
  lines: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FALLBACK_CLIENT_LABEL = 'Client'
const FALLBACK_BOOKING_LABEL = 'Appointment'
const FALLBACK_BLOCK_LABEL = 'Personal time'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function textClampStyle(options: TextClampOptions): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: options.lines,
    overflow: 'hidden',
  }
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function serviceItemCountLabel(event: CalendarEvent): string | null {
  if (event.kind === 'BLOCK') return null

  const serviceCount = event.details.serviceItems.length

  if (serviceCount <= 1) return null

  return `${serviceCount} services`
}

function buildEventCardCopy(args: {
  event: CalendarEvent
  statusLabel: string
}): EventCardCopy {
  const { event, statusLabel } = args

  if (event.kind === 'BLOCK') {
    const note = normalizeText(event.note)

    return {
      primary: note || FALLBACK_BLOCK_LABEL,
      secondary: note ? 'Break' : '',
      eyebrow: 'Break',
      status: statusLabel,
    }
  }

  const clientName = normalizeText(event.clientName)
  const bookingTitle = normalizeText(event.title)
  const serviceCount = serviceItemCountLabel(event)

  return {
    primary: clientName || FALLBACK_CLIENT_LABEL,
    secondary: bookingTitle || FALLBACK_BOOKING_LABEL,
    eyebrow: serviceCount ?? 'Booking',
    status: statusLabel,
  }
}

function cardTitle(event: CalendarEvent): string {
  if (event.kind === 'BLOCK') {
    return 'Drag to move, drag bottom to resize. Click to edit block.'
  }

  return 'Drag to move, drag bottom to resize. Click to view booking.'
}

function cardAriaLabel(args: {
  copy: EventCardCopy
  timeLabel: string
}): string {
  const { copy, timeLabel } = args

  return [copy.primary, copy.secondary, copy.status, timeLabel]
    .filter((part) => part.trim().length > 0)
    .join(', ')
}

function cardSurfaceOverlayClass(isBlocked: boolean): string {
  return [
    'before:pointer-events-none before:absolute before:inset-0',
    isBlocked
      ? 'before:bg-gradient-to-br before:from-paper/[0.06] before:to-transparent'
      : 'before:bg-gradient-to-br before:from-paper/[0.12] before:via-transparent before:to-black/[0.10]',
  ].join(' ')
}

function eventCardPositionStyle(args: {
  topPx: number
  heightPx: number
}): CSSProperties {
  return {
    top: args.topPx,
    height: args.heightPx,
  }
}

function openOnKeyboard(args: {
  event: KeyboardEvent<HTMLDivElement>
  eventId: string
  suppressClickRef: MutableRefObject<boolean>
  onClickEvent: (id: string) => void
}): void {
  const { event, eventId, suppressClickRef, onClickEvent } = args

  if (event.key !== 'Enter' && event.key !== ' ') return

  event.preventDefault()

  if (suppressClickRef.current) return

  onClickEvent(eventId)
}

function innerPaddingClassName(args: {
  compact: boolean
  micro: boolean
}): string {
  const { compact, micro } = args

  if (micro) return 'py-1 pl-2.5 pr-1.5'
  if (compact) return 'py-1.5 pl-2.5 pr-2'

  return 'py-2 pl-3 pr-2'
}

function rootClassName(args: {
  isBlocked: boolean
  border: string
  ring?: string
}): string {
  const { isBlocked, border, ring } = args

  return [
    'absolute left-0.5 right-0.5 z-20 overflow-hidden rounded-[7px] border',
    'md:left-1 md:right-1 md:rounded-xl',
    'text-left text-paper',
    'transition-transform duration-150 md:hover:scale-[1.01] active:scale-[0.995]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    cardSurfaceOverlayClass(isBlocked),
    border,
    ring ?? '',
  ].join(' ')
}

function primaryTextClassName(args: {
  compact: boolean
  micro: boolean
  isBlocked: boolean
}): string {
  const { compact, micro, isBlocked } = args

  return [
    'min-w-0 flex-1 truncate leading-none drop-shadow-[0_1px_1px_rgb(0_0_0_/_0.45)]',
    isBlocked
      ? 'font-mono uppercase tracking-[0.08em]'
      : 'font-display italic tracking-[-0.025em]',
    micro ? 'text-[9px]' : compact ? 'text-[10px]' : 'text-[11px]',
    isBlocked ? 'font-bold text-paperDim' : 'font-semibold text-paper',
  ].join(' ')
}

function secondaryTextClassName(compact: boolean): string {
  return [
    'mt-0.5 truncate font-sans leading-tight text-paperDim',
    compact ? 'text-[8px]' : 'text-[9px]',
  ].join(' ')
}

function timeTextClassName(compact: boolean): string {
  return [
    'mt-auto truncate font-mono uppercase tracking-[0.04em] text-paperMute',
    compact ? 'pt-0.5 text-[7px]' : 'pt-1 text-[8px]',
  ].join(' ')
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PendingBadge() {
  return (
    <span
      className={[
        'hidden shrink-0 items-center rounded-sm border border-tonePending/35 bg-tonePending/15',
        'px-1 py-px font-mono text-[7px] font-black uppercase tracking-[0.08em] text-tonePending',
        'md:inline-flex',
      ].join(' ')}
    >
      Request
    </span>
  )
}

function CompletedCheck() {
  return (
    <span
      className="hidden shrink-0 text-fern md:inline-flex"
      aria-hidden="true"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function EventCard(props: EventCardProps) {
  const {
    ev,
    entityType,
    apiId,
    topPx,
    heightPx,
    timeLabel,
    compact,
    micro,
    day,
    startMinutes,
    originalDuration,
    getColumnTop,
    suppressClickRef,
    onClickEvent,
    onDragStart,
    onDropOnDayColumn,
    onBeginResize,
  } = props

  const isBlocked = ev.kind === 'BLOCK'
  const statusMeta = calendarStatusMeta({ status: ev.status, isBlocked })
  const card = eventCardClasses({ status: ev.status, isBlocked })
  const accent = eventAccentBgClassName({ status: ev.status, isBlocked })
  const copy = buildEventCardCopy({ event: ev, statusLabel: statusMeta.label })

  const isPending = statusMeta.tone === 'pending'
  const isCompleted = statusMeta.tone === 'completed'
  const canDragOrResize = apiId !== null

  return (
    <div
      data-cal-event="1"
      data-calendar-event-kind={ev.kind}
      data-calendar-event-status={statusMeta.normalizedStatus || 'SCHEDULED'}
      data-calendar-event-tone={statusMeta.tone}
      role="button"
      tabIndex={0}
      aria-label={cardAriaLabel({ copy, timeLabel })}
      draggable={canDragOrResize}
      onDragStart={(dragEvent) => {
        if (!apiId) {
          dragEvent.preventDefault()
          return
        }

        onDragStart(ev, dragEvent)
      }}
      onDragOver={(dragEvent) => {
        dragEvent.preventDefault()
      }}
      onDrop={(dropEvent) => {
        dropEvent.preventDefault()
        dropEvent.stopPropagation()

        onDropOnDayColumn(day, dropEvent.clientY, getColumnTop())
      }}
      onMouseDown={(mouseEvent) => {
        mouseEvent.stopPropagation()
      }}
      onClick={() => {
        if (suppressClickRef.current) return
        onClickEvent(ev.id)
      }}
      onKeyDown={(keyboardEvent) => {
        openOnKeyboard({
          event: keyboardEvent,
          eventId: ev.id,
          suppressClickRef,
          onClickEvent,
        })
      }}
      className={rootClassName({
        isBlocked,
        border: card.border,
        ring: card.ring,
      })}
      style={eventCardPositionStyle({
        topPx,
        heightPx,
      })}
      title={cardTitle(ev)}
    >
      <div
        className={['absolute inset-y-0 left-0 w-0.5 md:w-1', accent].join(' ')}
        aria-hidden="true"
      />

      {isBlocked ? (
        <div
          className="pointer-events-none absolute inset-0 rounded-[7px] border border-dashed border-paper/10 md:rounded-xl"
          aria-hidden="true"
        />
      ) : null}

      <div
        className={[
          'relative flex h-full min-w-0 flex-col',
          innerPaddingClassName({ compact, micro }),
        ].join(' ')}
      >
        {micro ? (
          <div className="flex min-w-0 items-center gap-1">
            <span
              className={primaryTextClassName({
                compact,
                micro,
                isBlocked,
              })}
            >
              {isBlocked ? copy.primary.toUpperCase() : copy.primary}
            </span>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-1">
              <span
                className={primaryTextClassName({
                  compact,
                  micro,
                  isBlocked,
                })}
                style={textClampStyle({ lines: 1 })}
              >
                {isBlocked ? copy.primary.toUpperCase() : copy.primary}
              </span>

              {isPending ? <PendingBadge /> : null}
              {isCompleted ? <CompletedCheck /> : null}
            </div>

            {!isBlocked ? (
              <p
                className={secondaryTextClassName(compact)}
                style={textClampStyle({ lines: compact ? 1 : 2 })}
              >
                {copy.secondary}
              </p>
            ) : copy.secondary ? (
              <p className="mt-0.5 truncate font-mono text-[7px] uppercase tracking-[0.06em] text-paperMute">
                {copy.secondary}
              </p>
            ) : null}

            <p className={timeTextClassName(compact)}>{timeLabel}</p>
          </>
        )}

        <button
          type="button"
          onMouseDown={(mouseEvent) => {
            mouseEvent.stopPropagation()
            mouseEvent.preventDefault()

            if (!apiId) return

            onBeginResize({
              entityType,
              eventId: ev.id,
              apiId,
              day,
              startMinutes,
              originalDuration,
              columnTop: getColumnTop(),
            })
          }}
          className={[
            'absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize',
            'bg-white/0 transition hover:bg-white/10',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
            canDragOrResize ? '' : 'cursor-default',
          ].join(' ')}
          aria-label={`Resize ${copy.primary}`}
          disabled={!canDragOrResize}
        />
      </div>
    </div>
  )
}