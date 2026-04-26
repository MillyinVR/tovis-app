// app/pro/calendar/_components/CalendarDateStepper.tsx
'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarDateStepperVariant = 'mobile' | 'tablet' | 'desktop'

type CalendarDateStepperProps = {
  label: string
  todayLabel: string
  previousLabel: string
  nextLabel: string
  onToday: () => void
  onBack: () => void
  onNext: () => void
  variant: CalendarDateStepperVariant
  disabled?: boolean
}

type IconButtonDirection = 'previous' | 'next'

type IconProps = {
  direction: IconButtonDirection
}

type StepperIconButtonProps = {
  label: string
  direction: IconButtonDirection
  disabled: boolean
  onClick: () => void
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

function StepperIconButton(props: StepperIconButtonProps) {
  const { label, direction, disabled, onClick } = props

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="brand-pro-calendar-nav-button brand-focus"
      aria-label={label}
      title={label}
      data-calendar-nav-direction={direction}
    >
      <IconChevron direction={direction} />
    </button>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function CalendarDateStepper(props: CalendarDateStepperProps) {
  const {
    label,
    todayLabel,
    previousLabel,
    nextLabel,
    onToday,
    onBack,
    onNext,
    variant,
    disabled = false,
  } = props

  return (
    <div
      className="brand-pro-calendar-nav-row"
      role="group"
      aria-label={label}
      data-calendar-date-stepper={variant}
      data-disabled={disabled ? 'true' : 'false'}
    >
      <StepperIconButton
        label={previousLabel}
        direction="previous"
        disabled={disabled}
        onClick={onBack}
      />

      <button
        type="button"
        onClick={onToday}
        disabled={disabled}
        className="brand-pro-calendar-today-button brand-focus"
        aria-label={todayLabel}
        title={label}
      >
        {todayLabel}
      </button>

      <StepperIconButton
        label={nextLabel}
        direction="next"
        disabled={disabled}
        onClick={onNext}
      />
    </div>
  )
}