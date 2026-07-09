// app/pro/calendar/_components/MobileCalendarHeader.tsx
'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

type MobileCalendarHeaderProps = {
  title: string
  subtitle: string
  /** When provided, renders a chevron that collapses the summary chrome (stats /
   *  location) to give the timeline more room — the web counterpart of the iOS
   *  `chromeCollapsed` toggle. */
  collapsed?: boolean
  onToggleCollapse?: () => void
  expandLabel?: string
  collapseLabel?: string
}

// ─── Exported component ───────────────────────────────────────────────────────

export function MobileCalendarHeader(props: MobileCalendarHeaderProps) {
  const {
    title,
    subtitle,
    collapsed = false,
    onToggleCollapse,
    expandLabel,
    collapseLabel,
  } = props

  const toggleLabel = collapsed ? expandLabel : collapseLabel

  return (
    <header className="brand-pro-calendar-mobile-header">
      <div className="brand-pro-calendar-mobile-header-row">
        <div className="brand-pro-calendar-mobile-header-titles">
          <h1 className="brand-pro-calendar-title">{title}</h1>

          <p className="brand-pro-calendar-subtitle">{subtitle}</p>
        </div>

        {onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="brand-pro-calendar-collapse-toggle brand-focus"
            data-collapsed={collapsed ? 'true' : 'false'}
            aria-pressed={collapsed}
            aria-label={toggleLabel}
            title={toggleLabel}
          >
            <svg
              className="brand-pro-calendar-collapse-chevron"
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
      </div>
    </header>
  )
}
