// app/(main)/search/_components/DiscoverModeToggle.tsx
'use client'

import { Sparkles, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DiscoverMode } from '../_lib/discoverViewTypes'

interface DiscoverModeToggleProps {
  value: DiscoverMode
  onChange: (value: DiscoverMode) => void
}

const OPTIONS: {
  value: DiscoverMode
  label: string
  icon: typeof Sparkles
}[] = [
  { value: 'LOOKS', label: 'Looks', icon: Sparkles },
  { value: 'PROS', label: 'Find a pro', icon: MapPin },
]

export default function DiscoverModeToggle({ value, onChange }: DiscoverModeToggleProps) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-bgPrimary/20 p-1"
      role="group"
      aria-label="Discover mode"
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon
        const active = option.value === value

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full px-3',
              'font-mono text-[11px] font-black uppercase tracking-[0.08em]',
              'transition-colors duration-150',
              active
                ? 'bg-textPrimary text-bgPrimary'
                : 'text-textSecondary hover:text-textPrimary',
            )}
          >
            <Icon size={13} strokeWidth={2.4} />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
