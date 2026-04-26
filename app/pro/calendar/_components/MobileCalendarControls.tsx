// app/pro/calendar/_components/MobileCalendarControls.tsx
'use client'

import type { ViewMode } from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarViewLabels = Record<ViewMode, string>

type MobileCalendarControlsProps = {
  view: ViewMode
  setView: (view: ViewMode) => void
  headerLabel: string

  todayLabel: string
  previousLabel: string
  nextLabel: string
  viewTabsLabel: string
  ariaLabel: string

  onToday: () => void
  onBack: () => void
  onNext: () => void

  viewLabels: CalendarViewLabels
  viewAriaLabels: CalendarViewLabels
}

type IconButtonDirection = 'previous' | 'next'

type IconProps = {
  direction: IconButtonDirection
}

type ViewOption = {
  value: ViewMode
  label: string
  ariaLabel: string
}

type ViewTabButtonProps = ViewOption & {
  active: boolean
  onSelect: (view: ViewMode) => void
}

type IconButtonProps = {
  label: string
  onClick: () => void
  direction: IconButtonDirection
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VIEW_ORDER: readonly ViewMode[] = ['day', 'week', 'month']

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function buildViewOptions(args: {
  labels: CalendarViewLabels
  ariaLabels: CalendarViewLabels
}): ViewOption[] {
  const { labels, ariaLabels } = args

  return VIEW_ORDER.map((value) => ({
    value,
    label: labels[value],
    ariaLabel: ariaLabels[value],
  }))
}

function viewTabClassName(): string {
  return 'brand-pro-calendar-segment-button brand-focus'
}

function iconButtonClassName(): string {
  return 'brand-pro-calendar-nav-button brand-focus'
}

function todayButtonClassName(): string {
  return 'brand-pro-calendar-today-button brand-focus'
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconChevron(props: IconProps) {
  const { direction } = props

  const path =
    direction === 'previous'
      ? 'M12.75 4.75L7.25 10L12.75 15.25'
      : 'M7.25 4.75L12.75 10L7.25 15.25'

  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={path}
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
  const { value, label, ariaLabel, active, onSelect } = props

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      onClick={() => {
        if (!active) onSelect(value)
      }}
      className={viewTabClassName()}
      data-active={active ? 'true' : 'false'}
      data-calendar-view-option={value}
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
      data-calendar-nav-direction={direction}
    >
      <IconChevron direction={direction} />
    </button>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function MobileCalendarControls(props: MobileCalendarControlsProps) {
  const {
    view,
    setView,
    headerLabel,
    onToday,
    onBack,
    onNext,
    todayLabel,
    previousLabel,
    nextLabel,
    viewTabsLabel,
    viewLabels,
    viewAriaLabels,
    ariaLabel,
  } = props

  const viewOptions = buildViewOptions({
    labels: viewLabels,
    ariaLabels: viewAriaLabels,
  })

  return (
    <div
      className="brand-pro-calendar-controls"
      role="group"
      aria-label={ariaLabel}
    >
      <div
        className="brand-pro-calendar-segment"
        role="tablist"
        aria-label={viewTabsLabel}
      >
        {viewOptions.map((option) => (
          <ViewTabButton
            key={option.value}
            value={option.value}
            label={option.label}
            ariaLabel={option.ariaLabel}
            active={option.value === view}
            onSelect={setView}
          />
        ))}
      </div>

      <div className="brand-pro-calendar-nav-row">
        <IconButton
          label={previousLabel}
          onClick={onBack}
          direction="previous"
        />

        <button
          type="button"
          onClick={onToday}
          className={todayButtonClassName()}
          aria-label={todayLabel}
          title={headerLabel}
        >
          {todayLabel}
        </button>

        <IconButton label={nextLabel} onClick={onNext} direction="next" />
      </div>
    </div>
  )
}