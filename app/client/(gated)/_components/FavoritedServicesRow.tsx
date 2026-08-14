// app/client/(gated)/_components/FavoritedServicesRow.tsx
import Link from 'next/link'

import RemoteImage from '@/app/_components/media/RemoteImage'

import type { ClientHomeFavoriteService } from '../_data/getClientHomeData'
import { formatDuration, money } from './homeVisuals'

// Brand-token tile tints cycled per card (mirrors the design's teal/gold/iris).
const TILE_TINTS: string[] = ['bg-terra/15', 'bg-gold/15', 'bg-iris/15']

function serviceMeta(service: ClientHomeFavoriteService['service']): string {
  const price = money(service.minPrice)
  const duration = formatDuration(service.defaultDurationMinutes)
  return [
    service.category?.name ?? null,
    // A STARTING price, never a bare figure — the pro re-quotes at the chair.
    price ? `from ${price}` : null,
    duration,
  ]
    .filter(Boolean)
    .join(' · ')
}

function ServiceCard({
  favorite,
  index,
}: {
  favorite: ClientHomeFavoriteService
  index: number
}) {
  const { service } = favorite
  const tint = TILE_TINTS[index % TILE_TINTS.length] ?? TILE_TINTS[0]

  return (
    <div className="w-[152px] shrink-0 snap-start overflow-hidden rounded-[15px] border border-textPrimary/10 bg-[rgb(var(--surface-glass)/0.05)]">
      <Link
        href={`/search?q=${encodeURIComponent(service.name)}`}
        className="block"
      >
        <div className={`grid h-[112px] w-full place-items-center overflow-hidden ${tint}`}>
          {service.defaultImageUrl ? (
            <RemoteImage
              src={service.defaultImageUrl}
              alt={service.name}
              className="h-full w-full object-cover"
              width={152}
              height={112}
            />
          ) : (
            <svg width="26" height="26" viewBox="0 0 24 24" className="text-ember" fill="currentColor">
              <path d="M12 21s-7-4.35-9.5-8.5C.8 9.6 2 6 5.2 6c2 0 3.2 1.3 3.8 2.3C9.6 7.3 10.8 6 12.8 6 16 6 17.2 9.6 15.5 12.5 13 16.65 12 21 12 21z" />
            </svg>
          )}
        </div>
      </Link>

      <div className="p-3">
        <div className="truncate font-display text-[13.5px] font-semibold text-textPrimary">
          {service.name}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-textMuted">
          {serviceMeta(service)}
        </div>
        <Link
          href={`/search?q=${encodeURIComponent(service.name)}`}
          className="mt-2.5 flex h-[30px] items-center justify-center rounded-full bg-terra font-display text-[11.5px] font-bold text-onCta transition hover:opacity-95"
        >
          Book
        </Link>
      </div>
    </div>
  )
}

/**
 * Every section of the client home keeps its heading and explains itself when it
 * has nothing in it (Tori, 2026-08-14) — so a client on day one sees the shape of
 * the whole screen rather than a page that grows sections as they use it. This
 * one used to `return null`, which made it the only section on either platform
 * that vanished, and left the two clients showing different sets of cards to the
 * same account.
 *
 * The rows are a left-to-right rail of picture cards, matching Favorite pros.
 */
export default function FavoritedServicesRow({
  favoriteServices,
}: {
  favoriteServices: ClientHomeFavoriteService[]
}) {
  const services = favoriteServices.slice(0, 12)

  return (
    <section className="overflow-hidden rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div className="mb-3.5 flex items-end justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-textMuted">
          Favorited services
          {favoriteServices.length > 0 ? ` · ${favoriteServices.length}` : ''}
        </span>
        <Link
          href="/search"
          className="font-display text-[12.5px] font-semibold text-terra transition hover:opacity-80"
        >
          Browse
        </Link>
      </div>

      {services.length === 0 ? (
        <div>
          <p className="text-[13px] font-semibold text-textPrimary">
            No favorited services yet.
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-textMuted">
            Tap the heart on a service and it&apos;ll be one tap from booking
            here.
          </p>
          <Link
            href="/search"
            className="mt-3.5 inline-flex rounded-[12px] border border-textPrimary/16 px-4 py-2 text-[11.5px] font-bold text-textSecondary transition hover:border-terra/30 hover:text-terra"
          >
            Find services →
          </Link>
        </div>
      ) : (
        <div className="-mx-[18px] overflow-x-auto px-[18px] pb-1 [scrollbar-width:thin]">
          <div className="flex snap-x snap-mandatory gap-[11px]">
            {services.map((favorite, index) => (
              <ServiceCard
                key={favorite.id}
                favorite={favorite}
                index={index}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
