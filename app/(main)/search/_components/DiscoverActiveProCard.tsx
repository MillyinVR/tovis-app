// app/(main)/search/_components/DiscoverActiveProCard.tsx
'use client'

import Link from 'next/link'
import RemoteImage from '@/app/_components/media/RemoteImage'
import type { ApiPro } from '../_lib/discoverProTypes'

interface DiscoverActiveProCardProps {
  pro: ApiPro
  // External map links resolved by SearchMapClient via mapsHrefFromLocation /
  // directionsHrefFromLocation — passed straight through, never rebuilt here.
  openHref: string | null
  navHref: string | null
}

function buildStatLine(pro: ApiPro): string | null {
  const parts: string[] = []

  if (typeof pro.distanceMiles === 'number') parts.push(`${pro.distanceMiles.toFixed(1)} mi`)
  if (typeof pro.minPrice === 'number' && Number.isFinite(pro.minPrice)) {
    parts.push(`FROM $${Math.round(pro.minPrice)}`)
  }

  return parts.length ? parts.join(' · ') : null
}

export default function DiscoverActiveProCard({ pro, openHref, navHref }: DiscoverActiveProCardProps) {
  const statLine = buildStatLine(pro)

  return (
    <div className="rounded-card border border-white/10 bg-bgPrimary/25 p-3">
      <div className="flex items-center gap-3">
        <div className="relative h-13 w-13 shrink-0 overflow-hidden rounded-inner bg-bgPrimary/45">
          {pro.avatarUrl ? (
            <RemoteImage
              src={pro.avatarUrl}
              alt=""
              width={52}
              height={52}
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
            <span className="min-w-0 flex-1 truncate font-display text-[16px] font-semibold text-textPrimary">
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
          </div>

          {statLine ? (
            <div className="mt-1 font-mono text-[10.5px] font-bold tracking-[0.04em] text-accentPrimary">
              {statLine}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Link
          href={`/professionals/${encodeURIComponent(pro.id)}`}
          className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary transition-colors hover:bg-white/10"
        >
          View
        </Link>

        {openHref ? (
          <a
            href={openHref}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary transition-colors hover:bg-white/10"
          >
            Open
          </a>
        ) : null}

        {navHref ? (
          <a
            href={navHref}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary transition-colors hover:bg-accentPrimaryHover"
          >
            Navigate
          </a>
        ) : null}
      </div>
    </div>
  )
}
