// app/pro/calendar/_components/AutoAcceptToggle.tsx
'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AutoAcceptToggleVariant = 'bar' | 'card' | 'inline'

export type AutoAcceptToggleStatusCopy = {
  enabled: string
  disabled: string
  saving: string
}

type AutoAcceptToggleProps = {
  label: string
  enabled: boolean
  saving: boolean
  onToggle: (nextEnabled: boolean) => void | Promise<void>
  variant: AutoAcceptToggleVariant
  statusCopy: AutoAcceptToggleStatusCopy
  description?: string
  disabled?: boolean
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function statusLabel(args: {
  enabled: boolean
  saving: boolean
  statusCopy: AutoAcceptToggleStatusCopy
}): string {
  const { enabled, saving, statusCopy } = args

  if (saving) return statusCopy.saving

  return enabled ? statusCopy.enabled : statusCopy.disabled
}

function rootClassName(variant: AutoAcceptToggleVariant): string {
  if (variant === 'bar') return 'brand-pro-calendar-auto-bar'
  if (variant === 'card') return 'brand-pro-calendar-auto-card'

  return 'brand-pro-calendar-auto-inline'
}

function ariaStateLabel(enabled: boolean): string {
  return enabled ? 'on' : 'off'
}

// ─── Exported component ───────────────────────────────────────────────────────

export function AutoAcceptToggle(props: AutoAcceptToggleProps) {
  const {
    label,
    enabled,
    saving,
    onToggle,
    variant,
    statusCopy,
    description,
    disabled = false,
  } = props

  const isDisabled = disabled || saving
  const status = statusLabel({ enabled, saving, statusCopy })
  const ariaLabel = `${label} is ${ariaStateLabel(enabled)}`

  return (
    <div
      className={rootClassName(variant)}
      data-auto-accept-variant={variant}
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
          <div className="brand-pro-calendar-auto-title">{label}</div>

          <div className="brand-pro-calendar-auto-subtitle">
            {description ? `${status} · ${description}` : status}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          if (!isDisabled) {
            void onToggle(!enabled)
          }
        }}
        disabled={isDisabled}
        className="brand-pro-calendar-switch brand-focus"
        data-enabled={enabled ? 'true' : 'false'}
        data-saving={saving ? 'true' : 'false'}
        role="switch"
        aria-checked={enabled}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="brand-pro-calendar-switch-thumb" />
      </button>
    </div>
  )
}