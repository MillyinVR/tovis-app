// app/pro/calendar/_components/MobileCalendarFab.tsx
'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

type MobileCalendarFabProps = {
  onClick: () => void
  label?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_LABEL = 'Create blocked time'

// ─── Exported component ───────────────────────────────────────────────────────

export function MobileCalendarFab(props: MobileCalendarFabProps) {
  const { onClick, label = DEFAULT_LABEL } = props

  return (
    <button
      type="button"
      onClick={onClick}
      className="brand-pro-calendar-fab brand-focus"
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">+</span>
    </button>
  )
}