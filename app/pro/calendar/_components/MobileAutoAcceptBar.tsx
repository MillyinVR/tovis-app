// app/pro/calendar/_components/MobileAutoAcceptBar.tsx
'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

type MobileAutoAcceptBarProps = {
  enabled: boolean
  saving: boolean
  onToggle: () => void
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function statusLabel(args: {
  enabled: boolean
  saving: boolean
}): string {
  const { enabled, saving } = args

  if (saving) return 'Saving'

  return enabled ? 'On' : 'Off'
}

// ─── Exported component ───────────────────────────────────────────────────────

export function MobileAutoAcceptBar(props: MobileAutoAcceptBarProps) {
  const { enabled, saving, onToggle } = props
  const label = statusLabel({ enabled, saving })

  return (
    <div className="brand-pro-calendar-auto-bar">
      <div className="brand-pro-calendar-auto-copy">
        <span
          className="brand-pro-calendar-auto-dot"
          data-enabled={enabled ? 'true' : 'false'}
          aria-hidden="true"
        />

        <div>
          <div className="brand-pro-calendar-auto-title">Auto-accept</div>

          <div className="brand-pro-calendar-auto-subtitle">
            {label} · new bookings go live
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        disabled={saving}
        className="brand-pro-calendar-switch brand-focus"
        data-enabled={enabled ? 'true' : 'false'}
        aria-pressed={enabled}
        aria-label={`Auto-accept is ${enabled ? 'on' : 'off'}`}
        title={`Auto-accept is ${enabled ? 'on' : 'off'}`}
      >
        <span className="brand-pro-calendar-switch-thumb" />
      </button>
    </div>
  )
}