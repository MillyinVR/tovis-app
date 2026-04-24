// app/(main)/search/_components/DiscoverViewToggle.tsx
'use client'

import { Map, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DiscoverViewMode } from '../_lib/discoverViewTypes'

interface DiscoverViewToggleProps {
  value: DiscoverViewMode
  onChange: (value: DiscoverViewMode) => void
}

const OPTIONS: {
  value: DiscoverViewMode
  label: string
  icon: typeof Map
}[] = [
  { value: 'MAP', label: 'MAP', icon: Map },
  { value: 'GRID', label: 'GRID', icon: LayoutGrid },
]

export default function DiscoverViewToggle({ value, onChange }: DiscoverViewToggleProps) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Discover view">
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
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3',
              'font-mono text-[11px] font-black uppercase tracking-[0.08em]',
              'transition-colors duration-150',
              active
                ? 'border-textPrimary bg-textPrimary text-bgPrimary'
                : 'border-white/12 bg-bgPrimary/20 text-textPrimary hover:bg-white/10',
            )}
          >
            <Icon size={14} strokeWidth={2.4} />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}