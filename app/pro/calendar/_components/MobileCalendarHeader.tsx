// app/pro/calendar/_components/MobileCalendarHeader.tsx
'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

type MobileCalendarHeaderProps = {
  title: string
  subtitle: string
}

// ─── Exported component ───────────────────────────────────────────────────────

export function MobileCalendarHeader(props: MobileCalendarHeaderProps) {
  const { title, subtitle } = props

  return (
    <header className="brand-pro-calendar-mobile-header">
      <h1 className="brand-pro-calendar-title">{title}</h1>

      <p className="brand-pro-calendar-subtitle">{subtitle}</p>
    </header>
  )
}