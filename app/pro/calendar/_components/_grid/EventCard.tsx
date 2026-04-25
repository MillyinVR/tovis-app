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

/**
 * Diagonal stripe pattern for blocked/break slots.
 * Uses CSS custom properties so it white-labels cleanly.
 */
const BLOCKED_BG =
  'repeating-linear-gradient(45deg, rgb(var(--paper) / 0.04) 0 6px, transparent 6px 14px)'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function textClampStyle(options: TextClampOptions): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: options.lines,
    overflow: 'hidden',
  }
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

function serviceItemCountLabel(event: CalendarEvent) {
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
    // Only use `event.note` — the user-entered label (e.g. "Lunch", "Hold").
    // `event.title` is a system/API field that defaults to "Blocked", giving us
    // nothing useful and causing micro cards to show a single "B". The diagonal
    // stripe + accent bar already communicate that this is blocked time; the note
    // is the only copy that adds actual information.
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

function cardTitle(event: CalendarEvent) {
  if (event.kind === 'BLOCK') {
    return 'Drag to move, drag bottom to resize. Click to edit block.'
  }

  return 'Drag to move, drag bottom to resize. Click to view booking.'
}

function cardAriaLabel(args: { copy: EventCardCopy; timeLabel: string }) {
  const { copy, timeLabel } = args
  return `${copy.primary}, ${copy.secondary}, ${copy.status}, ${timeLabel}`
}

/**
 * Dark gradient surface for booking cards; empty string for blocked (uses
 * inline style instead — gradients can't be expressed as Tailwind utilities).
 */
function cardSurfaceClass(isBlocked: boolean): string {
  if (isBlocked) return ''
  return 'bg-gradient-to-br from-bgSecondary/95 to-bgSurface/95'
}

function openOnKeyboard(args: {
  event: KeyboardEvent<HTMLDivElement>
  eventId: string
  suppressClickRef: MutableRefObject<boolean>
  onClickEvent: (id: string) => void
}) {
  const { event, eventId, suppressClickRef, onClickEvent } = args

  if (event.key !== 'Enter' && event.key !== ' ') return

  event.preventDefault()

  if (suppressClickRef.current) return

  onClickEvent(eventId)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Inline pill shown on PENDING / RESCHEDULE_REQUESTED cards next to the
 * client name. Uses toneWarn from the design-token layer — not a hardcoded color.
 */
function PendingBadge() {
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center',
        'rounded-sm border border-toneWarn/30 bg-toneWarn/10',
        'px-1.5 py-px',
        'font-mono text-[8px] font-black uppercase tracking-[0.08em] text-toneWarn',
      ].join(' ')}
    >
      Request
    </span>
  )
}

/**
 * Small checkmark shown on COMPLETED cards next to the client name.
 */
function CompletedCheck() {
  return (
    <span className="shrink-0 text-toneSuccess" aria-hidden="true">
      <svg
        width="11"
        height="11"
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

// ─── Main component ───────────────────────────────────────────────────────────

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

  const innerPadding = micro
    ? 'py-1 pl-3.5 pr-2'
    : compact
      ? 'py-2 pl-3.5 pr-2.5'
      : 'py-2.5 pl-4 pr-3'

  return (
    <div
      data-cal-event="1"
      data-calendar-event-kind={ev.kind}
      data-calendar-event-status={statusMeta.normalizedStatus || 'SCHEDULED'}
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
      className={[
        'absolute left-1 right-1 z-20 overflow-hidden rounded-2xl border',
        'text-left text-[var(--paper)]',
        'shadow-[0_6px_16px_rgb(0_0_0/0.45)]',
        'transition-transform duration-150 md:hover:scale-[1.01] active:scale-[0.995]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
        cardSurfaceClass(isBlocked),
        card.border,
        card.ring ?? '',
      ].join(' ')}
      style={{
        top: topPx,
        height: heightPx,
        background: isBlocked ? BLOCKED_BG : undefined,
      }}
      title={cardTitle(ev)}
    >
      {/* Left accent bar — color driven by statusStyles, single source of truth */}
      <div
        className={['absolute inset-y-0 left-0 w-1.5', accent].join(' ')}
        aria-hidden="true"
      />

      {/* Dashed border overlay for blocked slots */}
      {isBlocked ? (
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl border border-dashed border-white/10"
          aria-hidden="true"
        />
      ) : null}

      {/* ── Card content ── */}
      <div
        className={[
          'relative flex h-full flex-col',
          innerPadding,
        ].join(' ')}
      >
        {micro ? (
          // ── Micro layout: single cramped row ──────────────────────────
          // copy.primary for BLOCK events is now the note/title ("Lunch", "Personal
          // time" etc.) so no secondary fallback needed here.
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="min-w-0 flex-1 truncate font-sans text-[11px] font-bold leading-none text-[var(--paper)]"
            >
              {isBlocked ? copy.primary.toUpperCase() : copy.primary}
            </span>

            <span className="shrink-0 font-mono text-[8px] text-[var(--paper-mute)]">
              {timeLabel}
            </span>
          </div>
        ) : (
          // ── Standard layout: name → service → time ────────────────────
          <>
            {/* Row 1: client name + inline status markers */}
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className="min-w-0 flex-1 truncate font-sans font-bold leading-none text-[var(--paper)]"
                style={textClampStyle({ lines: 1 })}
                // font-size scales with compact to keep density consistent
              >
                <span
                  className={compact ? 'text-[12px]' : 'text-[13px]'}
                >
                  {isBlocked ? copy.primary.toUpperCase() : copy.primary}
                </span>
              </span>

              {isPending ? <PendingBadge /> : null}
              {isCompleted ? <CompletedCheck /> : null}
            </div>

            {/* Row 2: service name (booking only) — serif italic */}
            {!isBlocked ? (
              <p
                className={[
                  'mt-1 font-display italic leading-snug text-[var(--paper-dim)]',
                  compact ? 'text-[10px]' : 'text-[11px]',
                ].join(' ')}
                style={textClampStyle({ lines: compact ? 1 : 2 })}
              >
                {copy.secondary}
              </p>
            ) : (
              // Blocked: show "Break" sub-label when present (empty for unnamed blocks)
              copy.secondary ? (
                <p
                  className={[
                    'mt-0.5 truncate text-[var(--paper-mute)]',
                    compact ? 'text-[9px]' : 'text-[10px]',
                  ].join(' ')}
                >
                  {copy.secondary}
                </p>
              ) : null
            )}

            {/* Row 3: time — pushed to bottom, mono */}
            <p
              className={[
                'mt-auto truncate font-mono text-[var(--paper-mute)] tracking-[0.04em]',
                compact ? 'pt-1 text-[8px]' : 'pt-1.5 text-[9px]',
              ].join(' ')}
            >
              {timeLabel}
            </p>
          </>
        )}

        {/* Resize handle — always last so it's above content in the stacking context */}
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
          ].join(' ')}
          aria-label={`Resize ${copy.primary}`}
          disabled={!canDragOrResize}
        />
      </div>
    </div>
  )
}
