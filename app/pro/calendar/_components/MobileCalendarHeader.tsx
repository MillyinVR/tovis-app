// app/pro/calendar/_components/MobileCalendarHeader.tsx
'use client'

import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type MobileCalendarHeaderProps = {
  title: string
  subtitle: string
  backHref?: string
  backLabel?: string
  modeLabel?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BACK_HREF = '/'
const DEFAULT_BACK_LABEL = 'CLIENT'
const DEFAULT_MODE_LABEL = '◆ PRO MODE'

// ─── Exported component ───────────────────────────────────────────────────────

export function MobileCalendarHeader(props: MobileCalendarHeaderProps) {
  const {
    title,
    subtitle,
    backHref = DEFAULT_BACK_HREF,
    backLabel = DEFAULT_BACK_LABEL,
    modeLabel = DEFAULT_MODE_LABEL,
  } = props

  return (
    <header className="brand-pro-calendar-mobile-header">
      <div className="brand-pro-calendar-mobile-top-row">
        <Link
          href={backHref}
          className="brand-pro-calendar-client-link brand-focus"
          aria-label={`Go to ${backLabel.toLowerCase()}`}
        >
          <span aria-hidden="true">‹</span>
          {backLabel}
        </Link>

        <p className="brand-pro-calendar-mode-label">{modeLabel}</p>
      </div>

      <h1 className="brand-pro-calendar-title">{title}</h1>

      <p className="brand-pro-calendar-subtitle">{subtitle}</p>
    </header>
  )
}