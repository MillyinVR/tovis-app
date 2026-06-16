// lib/brand/ThemeToggle.tsx
'use client'

import { useBrand } from './BrandProvider'
import type { ThemePreference } from './theme'

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/**
 * System / Light / Dark segmented control. "System" follows the device's
 * prefers-color-scheme; an explicit choice persists. Reads/writes through
 * BrandProvider so the whole app re-themes instantly.
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useBrand()

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={[
        'inline-flex items-center gap-1 rounded-full border border-surfaceGlass/15 p-1',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {OPTIONS.map((opt) => {
        const active = preference === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPreference(opt.value)}
            className={[
              'rounded-full px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] transition',
              active
                ? 'bg-accentPrimary text-onAccent'
                : 'text-textMuted hover:text-textPrimary',
            ].join(' ')}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
