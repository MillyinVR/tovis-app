// app/pro/calendar/_components/CalendarHeader.tsx
'use client'

import type { ReactNode } from 'react'

import type { ViewMode } from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarHeaderControlsProps = {
  view: ViewMode
  setView: (view: ViewMode) => void
  headerLabel: string
  onToday: () => void
  onBack: () => void
  onNext: () => void

  /**
   * Desktop-only inline CTA.
   * Mobile uses MobileCalendarFab instead.
   */
  onBlockTime?: () => void
}

type IconProps = {
  className?: string
}

type IconButtonProps = {
  label: string
  onClick: () => void
  children: ReactNode
}

type ViewOption = {
  value: ViewMode
  label: string
}

type ViewTabButtonProps = ViewOption & {
  active: boolean
  onSelect: (view: ViewMode) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VIEW_OPTIONS: ReadonlyArray<ViewOption> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function viewTabClassName(): string {
  return 'brand-pro-calendar-segment-button brand-focus'
}

function iconButtonClassName(): string {
  return 'brand-pro-calendar-nav-button brand-focus'
}

function todayButtonClassName(): string {
  return 'brand-pro-calendar-today-button brand-focus'
}

function blockTimeButtonClassName(): string {
  return 'brand-pro-calendar-block-button brand-focus'
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconChevronLeft(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={props.className}
    >
      <path
        d="M12.75 4.75L7.25 10L12.75 15.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconChevronRight(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={props.className}
    >
      <path
        d="M7.25 4.75L12.75 10L7.25 15.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ViewTabButton(props: ViewTabButtonProps) {
  const { value, label, active, onSelect } = props

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={`Switch to ${label.toLowerCase()} view`}
      onClick={() => {
        if (!active) onSelect(value)
      }}
      className={viewTabClassName()}
      data-active={active ? 'true' : 'false'}
    >
      {label}
    </button>
  )
}

function IconButton(props: IconButtonProps) {
  const { label, onClick, children } = props

  return (
    <button
      type="button"
      onClick={onClick}
      className={iconButtonClassName()}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function CalendarHeaderControls(props: CalendarHeaderControlsProps) {
  const { view, setView, headerLabel, onToday, onBack, onNext, onBlockTime } =
    props

  return (
    <div
      className="brand-pro-calendar-controls"
      role="group"
      aria-label="Calendar navigation"
    >
      <div
        className="brand-pro-calendar-segment"
        role="tablist"
        aria-label="Calendar view"
      >
        {VIEW_OPTIONS.map((option) => (
          <ViewTabButton
            key={option.value}
            value={option.value}
            label={option.label}
            active={option.value === view}
            onSelect={setView}
          />
        ))}
      </div>

      <div className="brand-pro-calendar-nav-row">
        <IconButton label="Previous calendar range" onClick={onBack}>
          <IconChevronLeft className="h-4 w-4" />
        </IconButton>

        <button
          type="button"
          onClick={onToday}
          className={todayButtonClassName()}
          aria-label="Go to today"
          title={headerLabel}
        >
          Today
        </button>

        <IconButton label="Next calendar range" onClick={onNext}>
          <IconChevronRight className="h-4 w-4" />
        </IconButton>

        {onBlockTime ? (
          <button
            type="button"
            onClick={onBlockTime}
            className={blockTimeButtonClassName()}
            aria-label="Create blocked time"
            title="Create blocked time"
          >
            + Block time
          </button>
        ) : null}
      </div>
    </div>
  )
}