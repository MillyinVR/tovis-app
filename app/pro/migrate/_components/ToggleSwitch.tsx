'use client'

// app/pro/migrate/_components/ToggleSwitch.tsx

type Props = {
  on: boolean
  onChange: (next: boolean) => void
  label: string
}

export function ToggleSwitch({ on, onChange, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={[
        'relative inline-flex h-6 w-[42px] shrink-0 items-center rounded-full transition',
        on ? 'bg-accentPrimary' : 'bg-white/10',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-5 w-5 rounded-full bg-bgSurface shadow transition',
          on ? 'translate-x-[19px]' : 'translate-x-[2px]',
        ].join(' ')}
        aria-hidden="true"
      />
    </button>
  )
}
