// app/professionals/[id]/ProfileHero.tsx
// app/professionals/[id]/ProfileHero.tsx
import Link from 'next/link'

import RemoteImage from '@/app/_components/media/RemoteImage'
import type {
  PublicProfileHeaderDto,
  PublicProfileStatsDto,
} from '@/lib/profiles/publicProfileMappers'
import SocialLinkChips from '@/app/_components/profiles/SocialLinkChips'

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
          <RemoteImage
            src={header.avatarUrl}
            alt={header.displayName}
            className="brand-profile-hero-media"
            intrinsic
          />
        ) : (
          <div className="brand-profile-hero-fallback" aria-hidden />
        )}

        <div className="brand-profile-hero-overlay" aria-hidden />

        <div className="brand-profile-hero-actions">
          <Link
            href={backHref}
            className="brand-button-ghost brand-focus tap-target grid h-9 w-9 place-items-center text-[18px] font-black"
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

          {header.isLicenseVerified ? (
            <div className="mt-2">
              <span
                className="inline-flex items-center gap-1 rounded-full border border-[rgb(var(--color-acid))]/35 bg-[rgb(var(--color-acid))]/12 px-2.5 py-0.5 text-[11px] font-black text-[rgb(var(--color-acid))]"
                title="This pro's professional license has been verified."
              >
                ✓ License verified
              </span>
            </div>
          ) : null}

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

          <SocialLinkChips
            instagramHandle={header.instagramHandle}
            tiktokHandle={header.tiktokHandle}
            websiteUrl={header.websiteUrl}
            className="mt-2 flex flex-wrap items-center gap-2"
          />
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

