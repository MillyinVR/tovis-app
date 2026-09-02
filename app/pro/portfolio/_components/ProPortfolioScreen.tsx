// app/pro/portfolio/_components/ProPortfolioScreen.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { resolveDisplayCrop } from '@/lib/media/cropRect'
import { cn } from '@/lib/utils'
import { formatCompactCount } from '@/lib/format/compactCount'

import ProPortfolioSheets from './ProPortfolioSheets'
import ProPortfolioTileCard from './ProPortfolioTile'
import {
  isProPortfolioFilterKey,
  proLibraryHref,
  type ProPortfolioFilter,
  type ProPortfolioGroup,
  type ProPortfolioPageModel,
  type ProPortfolioTile,
} from '../_data/proPortfolioTypes'

export default function ProPortfolioScreen({
  model,
}: {
  model: ProPortfolioPageModel
}) {
  const [openTile, setOpenTile] = useState<ProPortfolioTile | null>(null)

  return (
    /* 🔴 A <section>, not a <main>. `app/pro/layout` already renders the page's
       <main>, and this now renders INSIDE the profile page's own scroll shell.

       And no two-column grid. `.brand-pro-layout-main > *` caps every child at
       --mobile-shell-width (430px) unless a screen opts out by name the way
       Finance and Last Minute do — so `md:grid-cols-[1fr_320px]` resolved to
       `0px 320px` and the whole library rendered into a zero-width column at
       every desktop width. Measured 1440/1280/1024/820/768: identical. The side
       rail was the designer's own first thing to cut if the screen fought
       itself, and this is the screen fighting itself. */
    /* The inset matches its sibling tabs exactly (`.brand-pro-profile-services`
       and `.brand-pro-profile-reviews` are both `padding: 16px 16px 40px`). The
       shell itself has no horizontal padding — every section supplies its own —
       so without this the grid ran edge to edge under an inset tab row. */
    <section aria-label="Your work" className="w-full px-4 pb-10 pt-4">
      {/* The page title, the avatar, the stats and the Upload button all live
          in the profile header directly above this. Repeating them here is what
          made the old standalone screen read as a second, rival profile. */}
      <p className="text-[13px] leading-relaxed text-textMuted">
        {model.subtitle}
      </p>

      <div className="mt-[18px]">
        <div className="min-w-0">
          {model.showSearch ? <SearchBox initial={model.searchQuery} /> : null}

          {model.filters.length > 0 && !model.isBlank ? (
            <FilterRow filters={model.filters} />
          ) : null}

          {model.lead ? (
            <LeadCard lead={model.lead} onOpen={setOpenTile} />
          ) : null}

          {model.publicTiles.length > 0 ? (
            <section className="mt-[26px]" aria-label="Public photos">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="inline-flex items-center gap-2">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="text-accentPrimary"
                    aria-hidden="true"
                  >
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span className="brand-cap text-[10px] text-accentPrimary">
                    Public · {model.counts.publicCount}
                  </span>
                </span>
                <span className="brand-cap text-[9px] text-textMuted">
                  Newest first
                </span>
              </div>
              <p className="mb-3 text-[12.5px] leading-relaxed text-textMuted">
                Exactly what a client sees on your profile, and what&rsquo;s live
                in the Looks feed.
              </p>
              <TileGrid tiles={model.publicTiles} onOpen={setOpenTile} />
            </section>
          ) : null}

          {model.groups.map((group) => (
            <GroupSection key={group.zone} group={group} onOpen={setOpenTile} />
          ))}

          {model.isBlank ? <BlankState uploadHref={model.routes.uploadNew} /> : null}
        </div>
      </div>

      <ProPortfolioSheets
        tile={openTile}
        serviceOptions={model.serviceOptions}
        onClose={() => setOpenTile(null)}
      />
    </section>
  )
}

function TileGrid({
  tiles,
  onOpen,
}: {
  tiles: ProPortfolioTile[]
  onOpen: (tile: ProPortfolioTile) => void
}) {
  // Three columns at every size. The pro shell is a fixed 430px column, so the
  // old `md:grid-cols-6` did not widen the grid — it halved the tiles the moment
  // the viewport crossed 768px, inside a container that never grew.
  return (
    <div className="grid grid-cols-3 gap-[9px]">
      {tiles.map((tile) => (
        <ProPortfolioTileCard key={tile.id} tile={tile} onOpen={onOpen} />
      ))}
    </div>
  )
}

function GroupSection({
  group,
  onOpen,
}: {
  group: ProPortfolioGroup
  onOpen: (tile: ProPortfolioTile) => void
}) {
  return (
    <section className="mt-[26px]" aria-label={group.title}>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="brand-cap text-[10px] text-textSecondary">
          {group.title} · {group.count}
        </span>
        {group.note ? (
          <span className="brand-cap text-[9px] text-microAccent">
            {group.note}
          </span>
        ) : null}
      </div>
      <p className="mb-3 text-[12.5px] leading-relaxed text-textMuted">
        {group.blurb}
      </p>
      <TileGrid tiles={group.tiles} onOpen={onOpen} />

      {group.remaining > 0 ? (
        <ShowMoreLink zone={group.zone} remaining={group.remaining} />
      ) : null}
    </section>
  )
}

/**
 * "Show N more" narrows the page to THIS zone, which is what lets the group
 * render uncapped.
 *
 * 🔴 It used to point at `WAITING` (for sessions) or `PRIVATE` (for uploads),
 * and neither worked. Every view re-caps a group at
 * `PRO_PORTFOLIO_GROUP_PAGE_SIZE`, so the destination showed the same six tiles
 * and offered "Show N more" again — a control that could never do the one thing
 * it named. `WAITING` was wrong twice over: a session zone also holds photos the
 * client HAS released, so the count and the destination disagreed as well.
 */
function ShowMoreLink({
  zone,
  remaining,
}: {
  zone: ProPortfolioGroup['zone']
  remaining: number
}) {
  return (
    <Link
      href={proLibraryHref({ filter: zone })}
      className={cn(
        'brand-focus mt-3 flex h-[42px] w-full items-center justify-center rounded-[14px]',
        'border border-textPrimary/10 bg-textPrimary/5 text-[13.5px] font-bold text-textPrimary',
        'transition hover:border-textPrimary/25',
      )}
    >
      Show {remaining} more
    </Link>
  )
}

function FilterRow({ filters }: { filters: ProPortfolioFilter[] }) {
  const router = useRouter()

  return (
    /* 🔴 Wraps, never scrolls. In a 430px shell the four chips measured 491px
       of scrollWidth, so "Waiting" sat entirely outside the viewport in an
       overflow-x row with no scrollbar and no affordance — and it is the one
       chip that reveals the consent-held state, which production says is the
       MAJORITY state (65 of 70 assets). An invisible chip is a missing feature. */
    <div className="flex flex-wrap gap-2 pb-0.5" role="group" aria-label="Filter photos">
      {filters.map((filter) => (
        <button
          key={filter.key}
          type="button"
          aria-pressed={filter.active}
          onClick={() =>
            router.push(proLibraryHref({ filter: filter.key }))
          }
          className={cn(
            'brand-focus inline-flex h-8 flex-none items-center gap-1.5 rounded-[10px] px-3',
            'font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition',
            filter.active
              ? 'border border-accentPrimary/30 bg-accentPrimary/10 text-accentPrimary'
              : 'border border-textPrimary/10 bg-textPrimary/5 text-textSecondary hover:border-textPrimary/25',
          )}
        >
          {filter.label}
          {filter.count === null ? null : ` ${formatCompactCount(filter.count)}`}
        </button>
      ))}
    </div>
  )
}

function SearchBox({ initial }: { initial: string | null }) {
  const router = useRouter()
  const params = useSearchParams()
  const [value, setValue] = useState(initial ?? '')

  const submit = (next: string) => {
    // Preserve whatever filter the pro is already standing in; only `q` moves.
    const current = params?.get('filter')
    router.push(
      proLibraryHref({
        filter: isProPortfolioFilterKey(current) ? current : undefined,
        q: next,
      }),
    )
  }

  return (
    <form
      className={cn(
        'mb-[11px] flex items-center gap-[9px] rounded-[13px] px-[13px] py-[11px]',
        'border border-textPrimary/10 bg-textPrimary/5',
      )}
      onSubmit={(event) => {
        event.preventDefault()
        submit(value)
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="flex-none text-textMuted"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search captions and clients"
        aria-label="Search your photos"
        className="w-full bg-transparent text-[13.5px] text-textPrimary outline-none placeholder:text-textMuted"
      />
    </form>
  )
}

/**
 * The launch-state nudge. It names what the empty profile COSTS rather than
 * describing the screen, and every photo it offers is one the client has
 * already released — an invitation that ended in a consent refusal would be
 * worse than no invitation.
 */
function LeadCard({
  lead,
  onOpen,
}: {
  lead: NonNullable<ProPortfolioPageModel['lead']>
  onOpen: (tile: ProPortfolioTile) => void
}) {
  return (
    <section
      className={cn(
        'mt-4 rounded-[18px] p-4',
        'border border-accentPrimary/30 bg-accentPrimary/10',
      )}
      aria-label="Nothing public yet"
    >
      <div className="brand-cap mb-2 text-[9px] text-accentPrimary">
        Nothing public yet
      </div>
      <h2 className="font-display text-[17px] font-bold leading-tight tracking-[-0.02em] text-textPrimary">
        {lead.title}
      </h2>
      <p className="mt-[7px] text-[13px] leading-relaxed text-textSecondary">
        {lead.body}
      </p>

      <div className="mt-[14px] flex gap-[9px] overflow-x-auto">
        {lead.shots.map((shot) => (
          <button
            key={shot.id}
            type="button"
            onClick={() => onOpen(shot)}
            aria-label={`Publish ${shot.caption ?? 'this photo'}`}
            className="brand-focus block h-[88px] w-[66px] flex-none overflow-hidden rounded-[11px]"
          >
            <RemoteImage
              src={shot.src}
              alt=""
              className="h-full w-full object-cover"
              {...resolveDisplayCrop(shot)}
              intrinsic
            />
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => lead.shots[0] && onOpen(lead.shots[0])}
        className={cn(
          'brand-focus mt-[15px] flex h-[46px] w-full items-center justify-center rounded-[14px]',
          'bg-accentPrimary text-[14.5px] font-bold text-onAccent transition hover:bg-accentPrimaryHover',
        )}
      >
        {lead.ctaLabel}
      </button>
    </section>
  )
}

function BlankState({ uploadHref }: { uploadHref: string }) {
  return (
    <section
      className="mt-5 rounded-[18px] border border-textPrimary/10 bg-bgSurface p-[30px_20px] text-center"
      aria-label="Your work lives here"
    >
      <div className="mx-auto mb-[15px] grid h-[54px] w-[54px] place-items-center rounded-[17px] bg-accentPrimary">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-onAccent"
          aria-hidden="true"
        >
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </div>
      <h2 className="font-display text-[20px] font-bold tracking-[-0.02em] text-textPrimary">
        Your work lives here
      </h2>
      <p className="mx-auto mt-[9px] max-w-[330px] text-[13.5px] leading-relaxed text-textMuted">
        Upload a few photos of work you&rsquo;re proud of, and they&rsquo;ll be
        one tap from public. Everything you shoot at the chair lands here too,
        private until you and your client say otherwise.
      </p>
      <Link
        href={uploadHref}
        className={cn(
          'brand-focus mt-[18px] flex h-[46px] w-full items-center justify-center rounded-[14px]',
          'bg-accentPrimary text-[14.5px] font-bold text-onAccent transition hover:bg-accentPrimaryHover',
        )}
      >
        Upload your first Look
      </Link>
      <p className="mt-3 text-[12.5px] text-textMuted">
        Or finish a booking — session photos arrive on their own.
      </p>
    </section>
  )
}
