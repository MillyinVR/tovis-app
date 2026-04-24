// app/(main)/search/_components/DiscoverGridView.tsx
'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface DiscoverGridPro {
  id: string
  businessName: string | null
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
  if (typeof minPrice !== 'number') return 'VIEW'

  return `FROM $${Math.round(minPrice)}`
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
      <div className="rounded-card border border-white/10 bg-bgSecondary/80 p-4 text-[13px] font-semibold text-textSecondary">
        No pros found in this radius. Try increasing the distance or searching a different area.
      </div>
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
              aria-label={`Select ${pro.businessName || 'beauty professional'}`}
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
                    {pro.businessName || 'Beauty professional'}
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
                className="inline-flex h-8 items-center justify-center rounded-full border border-white/10 bg-bgPrimary/25 px-3 font-mono text-[10px] font-black uppercase tracking-[0.08em] text-textPrimary hover:bg-white/10"
              >
                View
              </Link>
            </div>
          </article>
        )
      })}
    </div>
  )
}