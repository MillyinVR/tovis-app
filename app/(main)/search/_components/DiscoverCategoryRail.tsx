// app/(main)/search/_components/DiscoverCategoryRail.tsx
'use client'

import type { DiscoverCategoryOption } from '@/lib/discovery/categoryTypes'
import { cn } from '@/lib/utils'

interface DiscoverCategoryRailProps {
  categories: DiscoverCategoryOption[]
  activeCategoryId: string | null
  onSelectCategory: (category: DiscoverCategoryOption) => void
  ariaLabel?: string
}

function isActiveCategory(category: DiscoverCategoryOption, activeCategoryId: string | null): boolean {
  if (category.kind === 'ALL') {
    return activeCategoryId === null
  }

  return category.id === activeCategoryId
}

function getCategoryKey(category: DiscoverCategoryOption): string {
  if (category.kind === 'ALL') {
    return `all:${category.slug}`
  }

  return `service-category:${category.id}`
}

export default function DiscoverCategoryRail({
  categories,
  activeCategoryId,
  onSelectCategory,
  ariaLabel = 'Discover categories',
}: DiscoverCategoryRailProps) {
  if (categories.length === 0) {
    return null
  }

  return (
    <nav aria-label={ariaLabel} className="looksNoScrollbar overflow-x-auto overflow-y-hidden">
      <div className="flex items-center gap-2 whitespace-nowrap px-1 pb-1">
        {categories.map((category) => {
          const active = isActiveCategory(category, activeCategoryId)

          return (
            <button
              key={getCategoryKey(category)}
              type="button"
              onClick={() => onSelectCategory(category)}
              aria-pressed={active}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-2',
                'font-mono text-[10px] font-black uppercase leading-none tracking-[0.12em]',
                'transition-colors duration-150',
                active
                  ? 'border-accentPrimary bg-accentPrimary text-bgPrimary'
                  : 'border-white/12 bg-bgPrimary/20 text-textPrimary hover:bg-white/10',
              )}
            >
              {category.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}