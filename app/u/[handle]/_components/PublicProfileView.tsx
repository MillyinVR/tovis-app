// app/u/[handle]/_components/PublicProfileView.tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ClientCreatorTier } from '@prisma/client'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { COPY } from '@/lib/copy'
import type {
  PublicClientBoard,
  PublicClientLook,
  PublicClientProfileData,
  PublicClientProfileStanding,
} from '../_data/loadPublicClientProfile'
import { useClientFollow, type FollowMode } from './followState'

export type { FollowMode }

/**
 * The public creator profile render — identity + standing, follow, and a
 * Looks/Boards switcher. Shared by the public `/u/[handle]` page and the
 * pro-facing client chart's "public profile" view so both surfaces show one
 * identical thing (house rule: no duplicate logic).
 *
 * A client component because the tab switcher and the follow toggle are both
 * interactive; everything it renders is still supplied by the server loader.
 */

const TABS = [
  { key: 'looks', label: COPY.publicProfile.tabLooks },
  { key: 'boards', label: COPY.publicProfile.tabBoards },
] as const

type TabKey = (typeof TABS)[number]['key']

function Avatar({
  name,
  url,
  tier,
}: {
  name: string
  url: string | null
  tier: ClientCreatorTier
}) {
  const showsTierMark = tier === ClientCreatorTier.TASTEMAKER

  return (
    <div className="relative h-[86px] w-[86px] shrink-0">
      {url ? (
        <div className="h-full w-full overflow-hidden rounded-full border border-textPrimary/10 bg-bgSecondary">
          <RemoteImage
            src={url}
            alt={name}
            className="h-full w-full object-cover"
            width={86}
            height={86}
          />
        </div>
      ) : (
        <div
          className="grid h-full w-full place-items-center rounded-full border border-textPrimary/10 bg-bgSecondary text-[34px] font-black text-textPrimary"
          aria-hidden="true"
        >
          {name.trim().slice(0, 1).toUpperCase() || '@'}
        </div>
      )}
      {showsTierMark ? (
        // Decorative twin of the Tastemaker pill beside the name, which carries
        // the accessible text — this must not repeat it to a screen reader.
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 grid h-[26px] w-[26px] place-items-center rounded-full bg-bgPrimary"
        >
          <span className="grid h-[21px] w-[21px] place-items-center rounded-full bg-toneWarn text-[11px] text-onAccent">
            ✦
          </span>
        </span>
      ) : null}
    </div>
  )
}

function StandingRow({ standing }: { standing: PublicClientProfileStanding }) {
  const isTastemaker = standing.tier === ClientCreatorTier.TASTEMAKER
  const isRising = standing.tier === ClientCreatorTier.RISING
  if (!isTastemaker && !isRising) return null

  // "top 5% saver · Brooklyn" — each half only appears when it's real. An
  // unranked creator has no percent, and the city is opt-in, so neither is
  // padded with a placeholder.
  const detail = [
    standing.topPercent !== null
      ? `${COPY.publicProfile.topPercentPrefix} ${standing.topPercent}${COPY.publicProfile.topPercentSuffix}`
      : null,
    standing.city,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2.5">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-toneWarn px-2.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.1em] text-toneWarn">
        <span aria-hidden="true">✦</span>
        {isTastemaker
          ? COPY.publicProfile.tierTastemaker
          : COPY.publicProfile.tierRising}
      </span>
      {detail ? (
        <span className="text-[12.5px] text-textSecondary">{detail}</span>
      ) : null}
    </div>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[15px] font-black text-textPrimary">{value}</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-textSecondary">
        {label}
      </span>
    </div>
  )
}

function LookCard({ look }: { look: PublicClientLook }) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-textPrimary/10 bg-bgSecondary">
      <Link href={look.href} className="block brand-focus">
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
          {/* Scrim so the title and pro line stay legible over any photo. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-bgPrimary/90 via-transparent to-bgPrimary/40"
          />

          {look.spotlighted ? (
            <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-toneWarn/60 bg-bgPrimary/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-toneWarn">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-toneWarn"
              />
              {COPY.publicProfile.spotlightBadge}
            </span>
          ) : null}

          <span
            className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-bgPrimary/60 px-2.5 py-1"
            aria-label={`${look.saveCount} ${COPY.publicProfile.savesLabel}`}
          >
            <span aria-hidden="true" className="text-[11px] text-toneDanger">
              ♥
            </span>
            <span
              aria-hidden="true"
              className="text-[9.5px] font-bold text-textPrimary"
            >
              {look.saveCount}
            </span>
          </span>

          <div className="absolute inset-x-3.5 bottom-3">
            <div className="truncate text-[18px] font-bold tracking-[-0.02em] text-textPrimary">
              {look.name}
            </div>
            <div className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-textSecondary">
              {[look.proName, look.serviceName].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
      </Link>

      <div className="px-3.5 pb-3.5 pt-3">
        <div className="mb-2.5 flex items-center justify-between gap-2.5">
          <span className="text-[10px] font-semibold tracking-[0.06em] text-textSecondary">
            {look.recreatedCount} {COPY.publicProfile.recreatedSuffix}
          </span>
          {/* ⚠️ Already composed as "From $X" by the loader — a look's price is a
              STARTING price, never a bare figure. */}
          {look.priceLabel ? (
            <span className="shrink-0 text-[12.5px] font-semibold text-accentPrimary">
              {look.priceLabel}
            </span>
          ) : null}
        </div>
        <Link
          href={look.recreateHref}
          className="flex h-[42px] items-center justify-center gap-2 rounded-[13px] bg-accentPrimary text-[13px] font-bold text-onAccent transition hover:opacity-90 brand-focus"
        >
          <span aria-hidden="true">⇄</span>
          {COPY.publicProfile.recreateCta}
        </Link>
      </div>
    </div>
  )
}

function BoardCard({ board }: { board: PublicClientBoard }) {
  return (
    <Link href={board.href} className="block brand-focus">
      {/* grid-rows-2 is load-bearing: without an explicit row track the rows are
          content-sized, the cell has no resolved height for `h-full` to fill,
          and each tile renders at the image's own aspect ratio inside a square
          that stays half empty. */}
      <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-[20px] border border-textPrimary/10 bg-bgSecondary">
        {/* Always four cells so a part-filled board keeps the mosaic's shape
            instead of stretching one image across the whole tile. */}
        {Array.from({ length: 4 }, (_, index) => {
          const url = board.tileImageUrls[index]
          return (
            <div key={index} className="relative overflow-hidden bg-bgPrimary">
              {url ? (
                <RemoteImage
                  src={url}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                  width={220}
                  height={220}
                />
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="mt-2.5 truncate text-[14px] font-bold text-textPrimary">
        {board.name}
      </div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-textSecondary">
        {board.itemCount} {COPY.publicProfile.savedSuffix}
      </div>
    </Link>
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
  const [tab, setTab] = useState<TabKey>('looks')
  const follow = useClientFollow({
    handle: data.handle,
    initialFollowing: data.viewer.following,
    initialFollowerCount: data.counts.followers,
  })

  return (
    <div aria-labelledby="public-profile-heading">
      <section className="mt-2 flex items-start gap-4">
        <Avatar
          name={data.handle}
          url={data.avatarUrl}
          tier={data.standing.tier}
        />
        <div className="min-w-0 flex-1 pt-0.5">
          <h1
            id="public-profile-heading"
            className="truncate font-display text-[28px] font-semibold italic leading-none"
          >
            {data.displayName}
          </h1>
          <StandingRow standing={data.standing} />
          <div className="mt-3.5 flex flex-wrap items-center gap-5">
            <Stat
              value={follow.followerCount}
              label={COPY.publicProfile.followersLabel}
            />
            <Stat
              value={data.counts.following}
              label={COPY.publicProfile.followingLabel}
            />
            <Stat
              value={data.counts.looks}
              label={COPY.publicProfile.looksLabel}
            />
          </div>
        </div>
      </section>

      {data.bio ? (
        <p className="mt-4 max-w-[520px] text-[14px] leading-relaxed text-textSecondary">
          {data.bio}
        </p>
      ) : null}

      {/* The design frame pairs Follow with a Message button. Message is omitted
          deliberately: client↔client threads don't exist, and a control that
          opens nothing is worse than no control on a page strangers land on. */}
      {followMode === 'client' ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void follow.toggle()}
            disabled={follow.loading}
            aria-pressed={follow.following}
            className={[
              'flex h-[46px] w-full items-center justify-center gap-2 rounded-[14px] text-[14px] font-bold transition brand-focus',
              follow.following
                ? 'border border-textPrimary/15 bg-bgSecondary text-textPrimary hover:border-textPrimary/30'
                : 'bg-accentPrimary text-onAccent hover:opacity-90',
              follow.loading ? 'cursor-wait opacity-75' : 'cursor-pointer',
            ].join(' ')}
          >
            {follow.following
              ? COPY.publicProfile.following
              : COPY.publicProfile.follow}
          </button>
          {follow.error ? (
            <div
              aria-live="polite"
              className="mt-2 text-[11px] font-semibold text-toneDanger"
            >
              {follow.error}
            </div>
          ) : null}
        </div>
      ) : null}

      {followMode === 'guest' ? (
        <div className="mt-4">
          <a
            href={loginHref}
            className="flex h-[46px] w-full items-center justify-center gap-2 rounded-[14px] bg-accentPrimary text-[14px] font-bold text-onAccent transition hover:opacity-90 brand-focus"
          >
            {COPY.publicProfile.follow}
          </a>
        </div>
      ) : null}

      <div className="mt-6 border-b border-textPrimary/10">
        <div role="tablist" aria-label="Profile sections" className="flex gap-7">
          {TABS.map((entry) => {
            const active = tab === entry.key
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`public-profile-panel-${entry.key}`}
                id={`public-profile-tab-${entry.key}`}
                onClick={() => setTab(entry.key)}
                className={[
                  'relative cursor-pointer pb-3.5 pt-1 text-[12px] font-black tracking-[0.08em] transition brand-focus',
                  active ? 'text-textPrimary' : 'text-textSecondary',
                ].join(' ')}
              >
                {entry.label}
                <span
                  aria-hidden="true"
                  className={[
                    'absolute inset-x-0 bottom-0 h-0.5 rounded-sm',
                    active ? 'bg-accentPrimary' : 'bg-transparent',
                  ].join(' ')}
                />
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'looks' ? (
        <section
          id="public-profile-panel-looks"
          role="tabpanel"
          aria-labelledby="public-profile-tab-looks"
          className="mt-5"
        >
          {data.looks.length > 0 ? (
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
              {data.looks.map((look) => (
                <LookCard key={look.id} look={look} />
              ))}
            </div>
          ) : (
            <div className="rounded-[22px] border border-textPrimary/10 px-4 py-10 text-center text-[14px] text-textSecondary">
              {COPY.publicProfile.emptyLooks}
            </div>
          )}
        </section>
      ) : (
        <section
          id="public-profile-panel-boards"
          role="tabpanel"
          aria-labelledby="public-profile-tab-boards"
          className="mt-5"
        >
          {data.boards.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-[18px] sm:grid-cols-3 lg:grid-cols-4">
              {data.boards.map((board) => (
                <BoardCard key={board.id} board={board} />
              ))}
            </div>
          ) : (
            <div className="rounded-[22px] border border-textPrimary/10 px-4 py-10 text-center text-[14px] text-textSecondary">
              {COPY.publicProfile.emptyBoards}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
