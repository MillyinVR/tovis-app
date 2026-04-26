// app/pro/calendar/_components/MobileCalendarControls.tsx
'use client'

import type { ViewMode } from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

type MobileCalendarControlsProps = {
  view: ViewMode
  setView: (view: ViewMode) => void
  headerLabel: string
  onToday: () => void
  onBack: () => void
  onNext: () => void
}

type IconProps = {
  className?: string
}

type ViewOption = {
  value: ViewMode
  label: string
}

type ViewTabButtonProps = ViewOption & {
  active: boolean
  onSelect: (view: ViewMode) => void
}

type IconButtonProps = {
  label: string
  onClick: () => void
  direction: 'previous' | 'next'
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
  const { label, onClick, direction } = props

  return (
    <button
      type="button"
      onClick={onClick}
      className={iconButtonClassName()}
      aria-label={label}
      title={label}
    >
      {direction === 'previous' ? (
        <IconChevronLeft className="h-4 w-4" />
      ) : (
        <IconChevronRight className="h-4 w-4" />
      )}
    </button>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function MobileCalendarControls(props: MobileCalendarControlsProps) {
  const { view, setView, headerLabel, onToday, onBack, onNext } = props

  return (
    <div
      className="brand-pro-calendar-controls"
      role="group"
      aria-label="Mobile calendar navigation"
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
        <IconButton
          label="Previous calendar range"
          onClick={onBack}
          direction="previous"
        />

        <button
          type="button"
          onClick={onToday}
          className="brand-pro-calendar-today-button brand-focus"
          aria-label="Go to today"
          title={headerLabel}
        >
          Today
        </button>

        <IconButton
          label="Next calendar range"
          onClick={onNext}
          direction="next"
        />
      </div>
    </div>
  )
}