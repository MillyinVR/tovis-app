// app/pro/calendar/_components/MobileAutoAcceptBar.tsx
'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

export type MobileAutoAcceptBarCopy = {
  title: string
  onLabel: string
  offLabel: string
  savingLabel: string
  subtitle: string
  ariaLabelOn: string
  ariaLabelOff: string
}

type MobileAutoAcceptBarProps = {
  copy: MobileAutoAcceptBarCopy
  enabled: boolean
  saving: boolean
  onToggle: () => void
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function statusLabel(args: {
  enabled: boolean
  saving: boolean
  copy: MobileAutoAcceptBarCopy
}): string {
  const { enabled, saving, copy } = args

  if (saving) return copy.savingLabel

  return enabled ? copy.onLabel : copy.offLabel
}

function ariaLabel(args: {
  enabled: boolean
  copy: MobileAutoAcceptBarCopy
}): string {
  return args.enabled ? args.copy.ariaLabelOn : args.copy.ariaLabelOff
}

// ─── Exported component ───────────────────────────────────────────────────────

export function MobileAutoAcceptBar(props: MobileAutoAcceptBarProps) {
  const { copy, enabled, saving, onToggle } = props

  const status = statusLabel({
    enabled,
    saving,
    copy,
  })

  const switchLabel = ariaLabel({
    enabled,
    copy,
  })

  return (
    <div
      className="brand-pro-calendar-auto-bar"
      data-enabled={enabled ? 'true' : 'false'}
      data-saving={saving ? 'true' : 'false'}
    >
      <div className="brand-pro-calendar-auto-copy">
        <span
          className="brand-pro-calendar-auto-dot"
          data-enabled={enabled ? 'true' : 'false'}
          aria-hidden="true"
        />

        <div>
          <div className="brand-pro-calendar-auto-title">{copy.title}</div>

          <div className="brand-pro-calendar-auto-subtitle">
            {status} · {copy.subtitle}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        disabled={saving}
        className="brand-pro-calendar-switch brand-focus"
        data-enabled={enabled ? 'true' : 'false'}
        data-saving={saving ? 'true' : 'false'}
        role="switch"
        aria-checked={enabled}
        aria-label={switchLabel}
        title={switchLabel}
      >
        <span className="brand-pro-calendar-switch-thumb" />
      </button>
    </div>
  )
}