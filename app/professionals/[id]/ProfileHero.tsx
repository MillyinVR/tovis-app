// app/professionals/[id]/ProfileHero.tsx
//
// Creator-page profile header (§18 redesign). The pro's chosen cover photo (or a
// branded fallback — never the stretched avatar) rides as a short banner; the
// face is a contained, overlapping avatar with the verified badge on it; the
// identity block + a bordered stats card + Book/Message sit below. The portfolio
// grid (the default tab) now rides high on the page instead of below a full-bleed
// 330px hero.
import Link from 'next/link'

import RemoteImage from '@/app/_components/media/RemoteImage'
import {
  formatFollowerLabel,
  formatInitial,
} from '@/lib/profiles/publicProfileFormatting'
import type {
  PublicProfileHeaderDto,
  PublicProfileStatsDto,
} from '@/lib/profiles/publicProfileMappers'
import SocialLinkChips from '@/app/_components/profiles/SocialLinkChips'

import FavoriteButton from './FavoriteButton'
import FollowButton from './FollowButton'
import ShareButton from './ShareButton'

type ProfileHeroProps = {
  header: PublicProfileHeaderDto
  stats: PublicProfileStatsDto
  isClientViewer: boolean
  // Clients and guests can follow (guests get the login redirect); a pro
  // viewer can't, so the pill is hidden for them.
  canFollow: boolean
  isFavoritedByMe: boolean
  messageHref: string
  servicesHref: string
  fromPath: string
  backHref?: string
}

export default function ProfileHero({
  header,
  stats,
  isClientViewer,
  canFollow,
  isFavoritedByMe,
  messageHref,
  servicesHref,
  fromPath,
  backHref = '/looks',
}: ProfileHeroProps) {
  return (
    <>
      <section className="brand-profile-cover">
        {header.coverUrl ? (
          <RemoteImage
            src={header.coverUrl}
            alt=""
            className="brand-profile-cover-media"
            intrinsic
          />
        ) : (
          <div className="brand-profile-hero-fallback" aria-hidden />
        )}

        <div className="brand-profile-cover-scrim" aria-hidden />

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
      </section>

      <section className="brand-profile-identity px-5">
        <div className="brand-profile-avatar-wrap">
          <div className="brand-profile-avatar">
            {header.avatarUrl ? (
              <RemoteImage
                src={header.avatarUrl}
                alt={header.displayName}
                className="brand-profile-avatar-img"
                intrinsic
              />
            ) : (
              <div className="brand-profile-avatar-fallback" aria-hidden>
                {formatInitial(header.displayName)}
              </div>
            )}
          </div>

          {header.isPremium ? (
            <span
              className="brand-profile-avatar-verified"
              aria-label="Verified professional"
              title="Verified professional"
            >
              ✓
            </span>
          ) : null}
        </div>

        {header.displayHandle ? (
          <div className="brand-cap mt-3">{header.displayHandle}</div>
        ) : null}

        <h1 className="brand-profile-display-name mt-1 truncate">
          {header.displayName}
        </h1>

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

        {canFollow ? (
          <FollowButton
            professionalId={header.id}
            initialFollowerCount={stats.followerCount}
            fromPath={fromPath}
          />
        ) : stats.followerCount > 0 ? (
          <div className="brand-profile-subtext mt-3">
            {formatFollowerLabel(stats.followerCount)}
          </div>
        ) : null}

        <SocialLinkChips
          instagramHandle={header.instagramHandle}
          tiktokHandle={header.tiktokHandle}
          websiteUrl={header.websiteUrl}
          className="mt-3 flex flex-wrap items-center gap-2"
        />
      </section>

      {header.bio ? (
        <section className="px-5 pb-4 pt-3">
          <p className="brand-profile-quote">“{header.bio}”</p>
        </section>
      ) : null}

      <section className="px-5 pb-4 pt-1">
        <div className="brand-profile-stats-card grid grid-cols-4">
          <ProfileHeroStat label="From" value={stats.priceFromLabel ?? '—'} />
          <ProfileHeroStat label="Booked" value={stats.completedBookingsLabel} />
          <ProfileHeroStat label="Rating" value={stats.averageRatingLabel ?? '—'} />
          <ProfileHeroStat label="Saved" value={stats.favoritesLabel} />
        </div>
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
    <div className="brand-profile-stat">
      <div className="brand-cap mb-1">{label}</div>
      <div className="brand-profile-stat-value">{value}</div>
    </div>
  )
}
