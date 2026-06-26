// app/(main)/search/_components/DiscoverProRows.tsx
'use client'

import type { MutableRefObject } from 'react'
import RemoteImage from '@/app/_components/media/RemoteImage'
import { cn } from '@/lib/utils'
import { preferredProLocation, type ApiPro } from '../_lib/discoverProTypes'

interface DiscoverProRowsProps {
  pros: ApiPro[]
  activeProId: string | null
  onSelect: (pro: ApiPro) => void
  // Shared ref map so the map → list scroll-into-view sync keeps working when
  // a pin is selected. Owned by SearchMapClient; the same map is used by both
  // the mobile bottom sheet and the desktop split list.
  itemRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>
}

function formatPriceLabel(minPrice: number | null): string | null {
  if (typeof minPrice !== 'number' || !Number.isFinite(minPrice)) return null

  return `FROM $${Math.round(minPrice)}`
}

export default function DiscoverProRows({ pros, activeProId, onSelect, itemRefs }: DiscoverProRowsProps) {
  return (
    <div className="grid gap-2">
      {pros.map((pro) => {
        const active = pro.id === activeProId
        const location = preferredProLocation(pro)
        const hasPin = location?.lat != null && location?.lng != null
        const priceLabel = formatPriceLabel(pro.minPrice)

        return (
          <button
            key={pro.id}
            ref={(element) => {
              itemRefs.current[pro.id] = element
            }}
            type="button"
            onClick={() => onSelect(pro)}
            className={cn(
              'flex w-full items-center gap-3 rounded-card border p-2.5 text-left transition-colors',
              active
                ? 'border-accentPrimary/60 bg-accentPrimary/10'
                : 'border-white/10 bg-bgPrimary/25 hover:bg-white/10',
            )}
          >
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-inner bg-bgPrimary/45">
              {pro.avatarUrl ? (
                <RemoteImage
                  src={pro.avatarUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div
                  aria-hidden
                  className="absolute inset-0 bg-linear-to-br from-white/10 via-white/2 to-black/25"
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-display text-[14px] font-semibold text-textPrimary">
                  {pro.displayName}
                </span>

                {typeof pro.ratingAvg === 'number' ? (
                  <span className="shrink-0 font-mono text-[11px] font-bold text-textSecondary">
                    ★ {pro.ratingAvg.toFixed(1)}
                  </span>
                ) : null}
              </div>

              <div className="mt-1 truncate text-[12px] font-semibold text-textSecondary">
                {(pro.professionType || 'Professional') + (pro.locationLabel ? ` · ${pro.locationLabel}` : '')}
                {!hasPin ? <span className="ml-2 text-microAccent">· no pin</span> : null}
              </div>

              <div className="mt-1.5 flex items-center gap-2 font-mono text-[10.5px] font-bold tracking-[0.04em]">
                {typeof pro.distanceMiles === 'number' ? (
                  <span className="text-textMuted">{pro.distanceMiles.toFixed(1)} mi</span>
                ) : null}
                {priceLabel ? <span className="text-accentPrimary">{priceLabel}</span> : null}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
