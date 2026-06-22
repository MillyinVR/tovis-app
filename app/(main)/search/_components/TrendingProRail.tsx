// app/(main)/search/_components/TrendingProRail.tsx
'use client'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { cn } from '@/lib/utils'

// Structural subset of the discover ApiPro — the rail only needs identity, a
// portrait, and the headline stats. ApiPro is assignable to this directly.
export interface TrendingProRailItem {
  id: string
  displayName: string
  avatarUrl: string | null
  locationLabel: string | null
  ratingAvg?: number | null
  minPrice?: number | null
}

interface TrendingProRailProps {
  pros: TrendingProRailItem[]
  onSelectPro: (pro: TrendingProRailItem) => void
}

function formatPriceBadge(minPrice: number | null | undefined): string | null {
  if (typeof minPrice !== 'number') return null

  return `$${Math.round(minPrice)}+`
}

export default function TrendingProRail({ pros, onSelectPro }: TrendingProRailProps) {
  if (pros.length === 0) return null

  return (
    <div className="looksNoScrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1">
      {pros.map((pro) => {
        const priceBadge = formatPriceBadge(pro.minPrice)

        return (
          <button
            key={pro.id}
            type="button"
            onClick={() => onSelectPro(pro)}
            className="w-35 shrink-0 text-left"
            aria-label={`Select ${pro.displayName}`}
          >
            <div className="relative aspect-7/9 overflow-hidden rounded-card bg-bgPrimary/45">
              {pro.avatarUrl ? (
                <RemoteImage
                  src={pro.avatarUrl}
                  alt=""
                  width={140}
                  height={180}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <>
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0,rgba(255,255,255,0.02)_35%,rgba(0,0,0,0.24)_100%)]"
                  />
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-20 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_10px,rgba(255,255,255,0.12)_11px,transparent_12px)]"
                  />
                </>
              )}

              {priceBadge ? (
                <div className="absolute right-2 top-2 rounded-full bg-bgPrimary/70 px-2 py-1 font-mono text-[10px] font-black text-textPrimary backdrop-blur-md">
                  {priceBadge}
                </div>
              ) : null}
            </div>

            <div className="mt-2">
              <div className="truncate text-[13px] font-black text-textPrimary">{pro.displayName}</div>

              <div className="mt-0.5 truncate text-[11px] font-semibold text-textMuted">
                {pro.locationLabel ? pro.locationLabel : 'Nearby'}
                {typeof pro.ratingAvg === 'number' ? (
                  <span className="text-textSecondary"> · ★ {pro.ratingAvg.toFixed(1)}</span>
                ) : null}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
