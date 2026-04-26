// app/pro/calendar/_components/CalendarViewSwitch.tsx
'use client'

import type { ViewMode } from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarViewLabels = Record<ViewMode, string>

export type CalendarViewSwitchVariant = 'mobile' | 'tablet' | 'desktop'

type CalendarViewSwitchProps = {
  view: ViewMode
  labels: CalendarViewLabels
  onChangeView: (view: ViewMode) => void
  variant: CalendarViewSwitchVariant
  disabled?: boolean
  ariaLabel?: string
}

type ViewOption = {
  value: ViewMode
  label: string
}

type ViewSwitchButtonProps = ViewOption & {
  active: boolean
  disabled: boolean
  onSelect: (view: ViewMode) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VIEW_ORDER: readonly ViewMode[] = ['day', 'week', 'month']

const DEFAULT_ARIA_LABEL = 'Calendar view'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function buildViewOptions(labels: CalendarViewLabels): ViewOption[] {
  return VIEW_ORDER.map((value) => ({
    value,
    label: labels[value],
  }))
}

function viewButtonAriaLabel(label: string): string {
  return `Switch to ${label.toLowerCase()} view`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ViewSwitchButton(props: ViewSwitchButtonProps) {
  const { value, label, active, disabled, onSelect } = props

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={viewButtonAriaLabel(label)}
      disabled={disabled}
      onClick={() => {
        if (!active && !disabled) {
          onSelect(value)
        }
      }}
      className="brand-pro-calendar-segment-button brand-focus"
      data-active={active ? 'true' : 'false'}
      data-calendar-view-option={value}
    >
      {label}
    </button>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function CalendarViewSwitch(props: CalendarViewSwitchProps) {
  const {
    view,
    labels,
    onChangeView,
    variant,
    disabled = false,
    ariaLabel = DEFAULT_ARIA_LABEL,
  } = props

  const viewOptions = buildViewOptions(labels)

  return (
    <div
      className="brand-pro-calendar-segment"
      role="tablist"
      aria-label={ariaLabel}
      data-calendar-view-switch={variant}
      data-disabled={disabled ? 'true' : 'false'}
    >
      {viewOptions.map((option) => (
        <ViewSwitchButton
          key={option.value}
          value={option.value}
          label={option.label}
          active={option.value === view}
          disabled={disabled}
          onSelect={onChangeView}
        />
      ))}
    </div>
  )
}