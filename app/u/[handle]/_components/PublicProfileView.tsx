// app/u/[handle]/_components/PublicProfileView.tsx
import Link from 'next/link'

import RemoteImage from '@/app/_components/media/RemoteImage'
import type { PublicClientProfileData } from '../_data/loadPublicClientProfile'
import ProfileStats, { type FollowMode } from './ProfileStats'

/**
 * The public creator profile render — avatar, handle, follow stats, bio, and
 * looks grid. Shared by the public `/u/[handle]` page and the pro-facing client
 * chart's "public profile" view so both surfaces show one identical thing
 * (house rule: no duplicate logic).
 */

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    return (
      <div className="h-[86px] w-[86px] shrink-0 overflow-hidden rounded-full border border-textPrimary/10 bg-bgSecondary">
        <RemoteImage
          src={url}
          alt={name}
          className="h-full w-full object-cover"
          width={86}
          height={86}
        />
      </div>
    )
  }
  return (
    <div
      className="grid h-[86px] w-[86px] shrink-0 place-items-center rounded-full border border-textPrimary/10 bg-bgSecondary text-[34px] font-black text-textPrimary"
      aria-hidden="true"
    >
      {name.trim().slice(0, 1).toUpperCase() || '@'}
    </div>
  )
}

export default function PublicProfileView({
  data,
  followMode,
  loginHref,
}: {
  data: PublicClientProfileData
  followMode: FollowMode
  loginHref: string
}) {
  return (
    <div aria-labelledby="public-profile-heading">
      <section className="mt-2 flex items-start gap-4">
        <Avatar name={data.handle} url={data.avatarUrl} />
        <div className="min-w-0 flex-1 pt-1">
          <h1
            id="public-profile-heading"
            className="truncate font-display text-[28px] font-semibold italic leading-none"
          >
            {data.displayName}
          </h1>
          <ProfileStats
            handle={data.handle}
            counts={data.counts}
            mode={followMode}
            initialFollowing={data.viewer.following}
            loginHref={loginHref}
          />
        </div>
      </section>

      {data.bio ? (
        <p className="mt-4 max-w-[520px] text-[14px] leading-relaxed text-textSecondary">
          {data.bio}
        </p>
      ) : null}

      <section className="mt-8" aria-label="Looks">
        {data.looks.length > 0 ? (
          <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
            {data.looks.map((look) => (
              <Link
                key={look.id}
                href={look.href}
                className="block overflow-hidden rounded-[22px] border border-textPrimary/10 bg-bgSecondary transition hover:border-textPrimary/20"
              >
                <div className="relative aspect-[1.1/1] bg-bgSecondary">
                  {look.imageUrl ? (
                    <RemoteImage
                      src={look.imageUrl}
                      alt={look.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      width={440}
                      height={400}
                    />
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                  <span className="truncate text-[14px] font-black text-textPrimary">
                    {look.name}
                  </span>
                  <span
                    className="shrink-0 text-[11px] font-bold text-textSecondary"
                    aria-label={`${look.saveCount} saves`}
                  >
                    <span aria-hidden="true">♥ {look.saveCount}</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-[22px] border border-textPrimary/10 px-4 py-10 text-center text-[14px] text-textSecondary">
            No public looks yet.
          </div>
        )}
      </section>
    </div>
  )
}
