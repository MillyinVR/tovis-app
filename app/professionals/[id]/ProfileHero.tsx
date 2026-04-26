// app/professionals/[id]/ProfileHero.tsx
// app/professionals/[id]/ProfileHero.tsx
import Link from 'next/link'

import type {
  PublicProfileHeaderDto,
  PublicProfileStatsDto,
} from '@/lib/profiles/publicProfileMappers'

import FavoriteButton from './FavoriteButton'
import ShareButton from './ShareButton'

type ProfileHeroProps = {
  header: PublicProfileHeaderDto
  stats: PublicProfileStatsDto
  isClientViewer: boolean
  isFavoritedByMe: boolean
  messageHref: string
  servicesHref: string
  backHref?: string
}

export default function ProfileHero({
  header,
  stats,
  isClientViewer,
  isFavoritedByMe,
  messageHref,
  servicesHref,
  backHref = '/looks',
}: ProfileHeroProps) {
  return (
    <>
      <section className="brand-profile-hero">
        {header.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={header.avatarUrl}
            alt={header.displayName}
            className="brand-profile-hero-media"
          />
        ) : (
          <div className="brand-profile-hero-fallback" aria-hidden />
        )}

        <div className="brand-profile-hero-overlay" aria-hidden />

        <div className="brand-profile-hero-actions">
          <Link
            href={backHref}
            className="brand-button-ghost brand-focus grid h-9 w-9 place-items-center text-[18px] font-black"
            aria-label="Back to Looks"
            title="Back to Looks"
          >
            ←
          </Link>

          <div className="flex items-center gap-2">
            <ShareButton url={`/professionals/${header.id}`} />

            {isClientViewer ? (
              <FavoriteButton
                professionalId={header.id}
                initialFavorited={isFavoritedByMe}
              />
            ) : null}
          </div>
        </div>

        <div className="brand-profile-hero-content">
          {header.displayHandle ? (
            <div className="brand-cap mb-2">{header.displayHandle}</div>
          ) : null}

          <div className="flex items-end gap-2">
            <h1 className="brand-profile-display-name truncate">
              {header.displayName}
            </h1>

            {header.isPremium ? (
              <span
                className="mb-1 text-[15px] font-black text-[rgb(var(--color-acid))]"
                aria-label="Verified professional"
                title="Verified professional"
              >
                ✓
              </span>
            ) : null}
          </div>

          <div className="brand-profile-subtext mt-2 flex flex-wrap items-center gap-2">
            <span>{header.professionLabel}</span>

            {header.location ? (
              <>
                <span className="brand-profile-muted">·</span>
                <span>{header.location}</span>
              </>
            ) : null}

            {stats.averageRatingLabel ? (
              <>
                <span className="brand-profile-muted">·</span>
                <span>★ {stats.averageRatingLabel}</span>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {header.bio ? (
        <section className="brand-profile-divider px-5 py-4">
          <p className="brand-profile-quote">“{header.bio}”</p>
        </section>
      ) : null}

      <section className="brand-profile-divider-strong grid grid-cols-4 px-5 py-4">
        <ProfileHeroStat label="From" value={stats.priceFromLabel ?? '—'} />
        <ProfileHeroStat label="Booked" value={stats.completedBookingsLabel} />
        <ProfileHeroStat label="Rating" value={stats.averageRatingLabel ?? '—'} />
        <ProfileHeroStat label="Saved" value={stats.favoritesLabel} />
      </section>

      <section className="brand-profile-divider flex gap-2 px-5 py-4">
        <Link
          href={servicesHref}
          className="brand-button-primary brand-focus flex flex-1 items-center justify-center px-5 py-4 text-[15px]"
        >
          Book now
        </Link>

        <Link
          href={messageHref}
          className="brand-button-secondary brand-focus flex flex-1 items-center justify-center px-5 py-4 text-[14px]"
        >
          Message
        </Link>
      </section>
    </>
  )
}

function ProfileHeroStat({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div>
      <div className="brand-cap mb-1">{label}</div>
      <div className="brand-profile-stat-value">{value}</div>
    </div>
  )
}