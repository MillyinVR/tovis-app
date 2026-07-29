// app/pro/bookings/[id]/aftercare/StepButtons.tsx
'use client'

// Quick date steppers (+1 day / +1 week / +1 month) shared by the aftercare
// rebook date fields. Styling stays at the call site via `buttonClass` so the
// buttons match their surrounding form.

import type { StepUnit } from './aftercareDates'

const STEP_UNITS: { unit: StepUnit; label: string }[] = [
  { unit: 'day', label: '+1 day' },
  { unit: 'week', label: '+1 week' },
  { unit: 'month', label: '+1 month' },
]

export default function StepButtons({
  disabled,
  onStep,
  onOpenCalendar,
  buttonClass,
}: {
  disabled: boolean
  onStep: (unit: StepUnit) => void
  onOpenCalendar?: () => void
  buttonClass: (disabled: boolean) => string
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {onOpenCalendar ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onOpenCalendar}
          className={buttonClass(disabled)}
        >
          📅 My calendar
        </button>
      ) : null}
      {STEP_UNITS.map(({ unit, label }) => (
        <button
          key={unit}
          type="button"
          disabled={disabled}
          onClick={() => onStep(unit)}
          className={buttonClass(disabled)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
