// app/pro/calendar/_components/MobileCalendarFab.tsx
'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

type MobileCalendarFabProps = {
  onClick: () => void
  label: string
  symbol?: string
  disabled?: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SYMBOL = '+'

// ─── Exported component ───────────────────────────────────────────────────────

export function MobileCalendarFab(props: MobileCalendarFabProps) {
  const {
    onClick,
    label,
    symbol = DEFAULT_SYMBOL,
    disabled = false,
  } = props

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="brand-pro-calendar-fab brand-focus"
      data-disabled={disabled ? 'true' : 'false'}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{symbol}</span>
    </button>
  )
}