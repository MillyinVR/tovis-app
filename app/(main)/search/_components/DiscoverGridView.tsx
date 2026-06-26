// app/(main)/search/_components/DiscoverGridView.tsx
'use client'

import Link from 'next/link'
import EmptyState from '@/app/_components/boundaries/EmptyState'
import { formatRoundedDollars } from '@/lib/money'
import { cn } from '@/lib/utils'

export interface DiscoverGridPro {
  id: string
  businessName: string | null
  displayName: string
  professionType: string | null
  locationLabel: string | null
  distanceMiles: number | null
  minPrice?: number | null
  ratingAvg?: number | null
  supportsMobile?: boolean
}

interface DiscoverGridViewProps {
  pros: DiscoverGridPro[]
  activeProId: string | null
  onSelectPro: (pro: DiscoverGridPro) => void
}

function formatPrice(minPrice: number | null | undefined): string {
  const dollars = formatRoundedDollars(minPrice)
  return dollars ? `FROM ${dollars}` : 'VIEW'
}

function formatMeta(pro: DiscoverGridPro): string {
  const parts: string[] = []

  if (pro.locationLabel) {
    parts.push(pro.locationLabel)
  }

  if (pro.supportsMobile) {
    parts.push('Mobile')
  }

  if (typeof pro.distanceMiles === 'number') {
    parts.push(`${pro.distanceMiles.toFixed(1)} mi`)
  }

  return parts.join(' · ')
}

export default function DiscoverGridView({ pros, activeProId, onSelectPro }: DiscoverGridViewProps) {
  if (pros.length === 0) {
    return (
      <EmptyState
        title="No pros found nearby"
        description="Try increasing the distance or searching a different area."
      />
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {pros.map((pro) => {
        const active = pro.id === activeProId
        const meta = formatMeta(pro)

        return (
          <article
            key={pro.id}
            className={cn(
              'overflow-hidden rounded-card border bg-bgSecondary',
              active ? 'border-accentPrimary/70' : 'border-white/10',
            )}
          >
            <button
              type="button"
              onClick={() => onSelectPro(pro)}
              className="block w-full text-left"
              aria-label={`Select ${pro.displayName}`}
            >
              <div className="relative aspect-[0.92] overflow-hidden bg-bgPrimary/45">
                <div
                  aria-hidden
                  className={cn(
                    'absolute inset-0',
                    'bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0,rgba(255,255,255,0.02)_35%,rgba(0,0,0,0.24)_100%)]',
                  )}
                />
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-20 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_10px,rgba(255,255,255,0.12)_11px,transparent_12px)]"
                />

                {pro.professionType ? (
                  <div className="absolute left-2 top-2 rounded-md bg-bgPrimary/80 px-2 py-1 font-mono text-[9px] font-black uppercase tracking-[0.12em] text-textPrimary">
                    {pro.professionType}
                  </div>
                ) : null}

                <div className="absolute bottom-2 right-2 rounded-full bg-accentPrimary px-3 py-2 font-mono text-[10px] font-black uppercase tracking-[0.08em] text-bgPrimary">
                  {formatPrice(pro.minPrice)}
                </div>
              </div>

              <div className="p-3">
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1 truncate text-[13px] font-black text-textPrimary">
                    {pro.displayName}
                  </div>

                  {typeof pro.ratingAvg === 'number' ? (
                    <div className="shrink-0 text-[11px] font-black text-textSecondary">
                      ★ {pro.ratingAvg.toFixed(1)}
                    </div>
                  ) : null}
                </div>

                {meta ? <div className="mt-1 truncate text-[11px] font-semibold text-textSecondary">{meta}</div> : null}
              </div>
            </button>

            <div className="px-3 pb-3">
              <Link
                href={`/professionals/${encodeURIComponent(pro.id)}`}
                className="flex h-9 w-full items-center justify-center rounded-full border border-white/15 bg-bgPrimary/25 font-mono text-[10px] font-black uppercase tracking-widest text-textPrimary transition-colors hover:bg-white/10"
              >
                View profile
              </Link>
            </div>
          </article>
        )
      })}
    </div>
  )
}