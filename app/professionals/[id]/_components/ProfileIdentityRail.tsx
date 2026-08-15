// app/professionals/[id]/_components/ProfileIdentityRail.tsx
//
// Screen 6 identity rail. Everything a client needs BEFORE the work: name,
// verification, licence, bio, a tappable location, the social three-up, and the
// payment methods the pro accepts.
//
// 🔴 What is deliberately NOT here:
//   - The four-stat card (From / Booked / Rating / Saved). "Nothing — and that
//     is the answer." Trust moves to the licence chip, the verified tick, the
//     grid and the reviews tab.
//   - Urgency chips on an ESTABLISHED pro. `signals.chips` is empty for them by
//     design (lib/profiles/proProfileSignals.ts), not for want of a read.
//   - A "Book now" button. Booking lives in exactly two quiet places, and
//     neither of them is up here.
import Link from 'next/link'

import RemoteImage from '@/app/_components/media/RemoteImage'
import SocialLinkChips from '@/app/_components/profiles/SocialLinkChips'
import { mapsHrefFromLocation } from '@/lib/maps'
import type { PublicAcceptedMethod } from '@/lib/payments/publicAcceptedMethods'
import {
  formatFollowerLabel,
  formatInitial,
} from '@/lib/profiles/publicProfileFormatting'
import type { PublicProfileHeaderDto } from '@/lib/profiles/publicProfileMappers'
import type { ProProfileSignalsDto } from '@/lib/profiles/proProfileSignals'

import FavoriteButton from '../FavoriteButton'
import FollowButton from '../FollowButton'
import ShareButton from '../ShareButton'

type ProfileIdentityRailProps = {
  header: PublicProfileHeaderDto
  followerCount: number
  isClientViewer: boolean
  canFollow: boolean
  isFavoritedByMe: boolean
  isPendingVerification: boolean
  messageHref: string
  fromPath: string
  acceptedPayments: PublicAcceptedMethod[]
  signals: ProProfileSignalsDto
}

export default function ProfileIdentityRail({
  header,
  followerCount,
  isClientViewer,
  canFollow,
  isFavoritedByMe,
  isPendingVerification,
  messageHref,
  fromPath,
  acceptedPayments,
  signals,
}: ProfileIdentityRailProps) {
  // Tori's standing rule: every address on either client is a maps link. This
  // one is a display city ("Williamsburg, Brooklyn"), so it searches by name —
  // there are no coordinates on a public profile to place a pin with.
  const locationHref = header.location
    ? mapsHrefFromLocation({ formattedAddress: header.location })
    : null

  return (
    <div className="relative">
      <div className="-mt-10 flex items-end justify-between gap-3">
        <div className="brand-pp-avatar">
          {header.avatarUrl ? (
            <RemoteImage
              src={header.avatarUrl}
              alt={header.displayName}
              className="brand-pp-avatar-img"
              intrinsic
            />
          ) : (
            <div className="brand-pp-avatar-fallback" aria-hidden>
              {formatInitial(header.displayName)}
            </div>
          )}
        </div>

        {canFollow ? (
          <FollowButton
            professionalId={header.id}
            initialFollowerCount={followerCount}
            fromPath={fromPath}
          />
        ) : null}
      </div>

      <div className="mt-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="brand-profile-display-name m-0 text-[length:var(--pp-name)] leading-none">
            {header.displayName}
          </h1>

          {header.isPremium ? (
            <span
              className="brand-profile-avatar-verified static grid h-5 w-5 border-0"
              aria-label="Verified professional"
              title="Verified professional"
            >
              ✓
            </span>
          ) : null}
        </div>

        {/* The follower count only joins the handle line once there IS one.
            "@demo-noor · 0 followers" states an absence nobody asked about. */}
        <div className="mt-2 font-mono text-[12px] tracking-[0.1em] text-textMuted">
          {[
            header.displayHandle,
            followerCount > 0 ? formatFollowerLabel(followerCount) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>

        <div className="mt-2 text-[14.5px] text-textSecondary">
          {header.professionLabel}
        </div>

        {header.location ? (
          <div className="mt-2.5">
            {locationHref ? (
              <a
                href={locationHref}
                target="_blank"
                rel="noreferrer"
                className="brand-focus inline-flex items-center gap-1.5 border-b border-[rgb(var(--surface-glass)/0.16)] pb-0.5 text-[13.5px] text-textSecondary hover:text-textPrimary"
              >
                <span aria-hidden className="text-accentPrimary">
                  ◉
                </span>
                {header.location}
                <span className="sr-only"> — open in maps</span>
              </a>
            ) : (
              <span className="text-[13.5px] text-textSecondary">
                {header.location}
              </span>
            )}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {header.isLicenseVerified ? (
            <span
              className="brand-pp-chip"
              title="This pro's professional license has been verified."
            >
              ✓ License verified
            </span>
          ) : null}

          {isPendingVerification ? (
            <span className="brand-pp-chip" data-tone="pending">
              Pending verification
            </span>
          ) : null}

          {/* Availability + "New to {brand}" — a BRAND-NEW pro only. */}
          {signals.chips.map((chip) => (
            <span key={chip.kind} className="brand-pp-chip">
              {chip.label}
            </span>
          ))}
        </div>

        {header.bio ? (
          <p className="mt-4 text-[15px] leading-[1.55] text-textSecondary">
            {header.bio}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Link href={messageHref} className="brand-pp-social-action brand-focus">
            Message
          </Link>

          {isClientViewer ? (
            <FavoriteButton
              professionalId={header.id}
              initialFavorited={isFavoritedByMe}
              variant="row"
            />
          ) : (
            // Signed out: Save renders in its unfilled state and opens the
            // sign-in sheet on tap, rather than vanishing.
            <Link
              href={`/login?from=${encodeURIComponent(fromPath)}`}
              className="brand-pp-social-action brand-focus"
            >
              <span aria-hidden="true">♡</span>
              <span>Save</span>
            </Link>
          )}

          <ShareButton
            url={`/professionals/${header.id}`}
            title={header.displayName}
            variant="row"
          />
        </div>

        <SocialLinkChips
          instagramHandle={header.instagramHandle}
          tiktokHandle={header.tiktokHandle}
          websiteUrl={header.websiteUrl}
          className="mt-3 flex flex-wrap items-center gap-2"
        />

        {/* Accepted payments moved UP, under the location: it answers a
            practical question at the moment someone is working out whether they
            can get to her. Handles stay hidden until checkout. */}
        {acceptedPayments.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 border-t border-[rgb(var(--surface-glass)/0.12)] pt-3.5">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-textMuted">
              Accepts
            </span>
            <span className="text-[12.5px] text-textMuted">
              {acceptedPayments.map((method) => method.label).join(' · ')}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
