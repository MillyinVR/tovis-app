// app/client/(gated)/_components/FavoritedServicesRow.tsx
import Link from 'next/link'

import RemoteImage from '@/app/_components/media/RemoteImage'

import type { ClientHomeFavoriteService } from '../_data/getClientHomeData'
import { formatDuration, money } from './homeVisuals'

// Brand-token tile tints cycled per row (mirrors the design's teal/gold/iris).
const TILE_TINTS: string[] = ['bg-terra/15', 'bg-gold/15', 'bg-iris/15']

function serviceMeta(service: ClientHomeFavoriteService['service']): string {
  const price = money(service.minPrice)
  const duration = formatDuration(service.defaultDurationMinutes)
  return [
    service.category?.name ?? null,
    price ? `from ${price}` : null,
    duration,
  ]
    .filter(Boolean)
    .join(' · ')
}

function ServiceRow({
  favorite,
  index,
  showDivider,
}: {
  favorite: ClientHomeFavoriteService
  index: number
  showDivider: boolean
}) {
  const { service } = favorite
  const tint = TILE_TINTS[index % TILE_TINTS.length] ?? TILE_TINTS[0]

  return (
    <div
      className={`flex items-center gap-3 py-3${
        showDivider ? ' border-b border-textPrimary/10' : ''
      }`}
    >
      <div
        className={`grid h-[34px] w-[34px] shrink-0 place-items-center overflow-hidden rounded-[10px] ${tint}`}
      >
        {service.defaultImageUrl ? (
          <RemoteImage
            src={service.defaultImageUrl}
            alt={service.name}
            className="h-full w-full object-cover"
            width={34}
            height={34}
          />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" className="text-ember" fill="currentColor">
            <path d="M12 21s-7-4.35-9.5-8.5C.8 9.6 2 6 5.2 6c2 0 3.2 1.3 3.8 2.3C9.6 7.3 10.8 6 12.8 6 16 6 17.2 9.6 15.5 12.5 13 16.65 12 21 12 21z" />
          </svg>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[14px] font-semibold text-textPrimary">
          {service.name}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-textMuted">
          {serviceMeta(service)}
        </div>
      </div>
      <Link
        href={`/search?q=${encodeURIComponent(service.name)}`}
        className="shrink-0 rounded-full border border-textPrimary/16 px-3.5 py-[7px] font-display text-[12px] font-bold text-textSecondary transition hover:border-textPrimary/25"
      >
        Book
      </Link>
    </div>
  )
}

export default function FavoritedServicesRow({
  favoriteServices,
}: {
  favoriteServices: ClientHomeFavoriteService[]
}) {
  if (favoriteServices.length === 0) return null

  const services = favoriteServices.slice(0, 5)

  return (
    <section className="rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div className="mb-2 flex items-end justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-textMuted">
          Favorited services · {favoriteServices.length}
        </span>
        <Link
          href="/search"
          className="font-display text-[12.5px] font-semibold text-terra transition hover:opacity-80"
        >
          Browse
        </Link>
      </div>
      <div className="flex flex-col">
        {services.map((favorite, index) => (
          <ServiceRow
            key={favorite.id}
            favorite={favorite}
            index={index}
            showDivider={index < services.length - 1}
          />
        ))}
      </div>
    </section>
  )
}
