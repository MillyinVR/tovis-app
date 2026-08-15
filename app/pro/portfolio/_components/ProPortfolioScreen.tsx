// app/pro/portfolio/_components/ProPortfolioScreen.tsx
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { cn } from '@/lib/utils'
import { formatCompactCount } from '@/lib/format/compactCount'

import ProPortfolioSheets from './ProPortfolioSheets'
import ProPortfolioTileCard from './ProPortfolioTile'
import type {
  ProPortfolioFilter,
  ProPortfolioGroup,
  ProPortfolioPageModel,
  ProPortfolioTile,
} from '../_data/proPortfolioTypes'

export default function ProPortfolioScreen({
  model,
}: {
  model: ProPortfolioPageModel
}) {
  const [openTile, setOpenTile] = useState<ProPortfolioTile | null>(null)

  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 pb-24 pt-6 md:px-12 md:pb-16 md:pt-10">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="brand-cap text-[10px] text-accentPrimary">My work</div>
          <h1 className="mt-2 font-display text-[27px] font-bold tracking-[-0.035em] text-textPrimary md:text-[38px]">
            {model.title}
          </h1>
          <p className="mt-[7px] max-w-[520px] text-[13.5px] leading-relaxed text-textMuted">
            {model.subtitle}
          </p>
        </div>

        <Link
          href={model.routes.uploadNew}
          className={cn(
            'brand-focus inline-flex h-10 flex-none items-center gap-2 rounded-[14px] px-[14px]',
            'border border-textPrimary/10 bg-textPrimary/5 text-[13.5px] font-bold text-textPrimary',
            'transition hover:border-textPrimary/25',
          )}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Upload
        </Link>
      </header>

      <div className="mt-[22px] md:grid md:grid-cols-[1fr_320px] md:items-start md:gap-[34px]">
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

        {/* The rail is desktop-only furniture for two one-time decisions, so it
            is the first thing to go when the screen is fighting itself. It never
            renders on a phone, where the grid already says everything it says. */}
        <SideRail model={model} />
      </div>

      <ProPortfolioSheets tile={openTile} onClose={() => setOpenTile(null)} />
    </main>
  )
}

function TileGrid({
  tiles,
  onOpen,
}: {
  tiles: ProPortfolioTile[]
  onOpen: (tile: ProPortfolioTile) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-[9px] md:grid-cols-6 md:gap-[14px]">
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
 * "Show N more" narrows the page to this zone rather than growing the grid in
 * place — the count is exact (it comes from a `count()`, not the capped page),
 * so this never claims more than exists.
 */
function ShowMoreLink({
  zone,
  remaining,
}: {
  zone: ProPortfolioGroup['zone']
  remaining: number
}) {
  const filter = zone === 'SESSIONS' ? 'WAITING' : 'PRIVATE'

  return (
    <Link
      href={`/pro/portfolio?filter=${filter}`}
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
    <div className="flex gap-2 overflow-x-auto pb-0.5" role="group" aria-label="Filter photos">
      {filters.map((filter) => (
        <button
          key={filter.key}
          type="button"
          aria-pressed={filter.active}
          onClick={() =>
            router.push(
              filter.key === 'ALL'
                ? '/pro/portfolio'
                : `/pro/portfolio?filter=${filter.key}`,
            )
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
    const search = new URLSearchParams(params?.toString() ?? '')
    if (next.trim()) search.set('q', next.trim())
    else search.delete('q')
    router.push(`/pro/portfolio${search.size ? `?${search}` : ''}`)
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

function SideRail({ model }: { model: ProPortfolioPageModel }) {
  const rows = useMemo(
    () => [
      { label: 'Public', value: model.counts.publicCount, gold: false },
      { label: 'Only you', value: model.counts.privateCount, gold: false },
      {
        label: 'Waiting on a client',
        value: model.counts.heldCount,
        gold: true,
      },
    ],
    [model.counts],
  )

  if (model.isBlank) return null

  return (
    <aside className="hidden rounded-[18px] border border-textPrimary/10 bg-bgSurface p-[18px] md:block">
      <div className="brand-cap mb-[14px] text-[9.5px] text-textMuted">
        Your public profile
      </div>

      {model.coverTile ? (
        <div className="overflow-hidden rounded-[14px] border border-textPrimary/10">
          <RemoteImage
            src={model.coverTile.src}
            alt=""
            className="block h-24 w-full object-cover"
            intrinsic
          />
          <div className="px-[13px] py-3">
            <div className="brand-cap text-[8.5px] text-microAccent">Cover</div>
            <p className="mt-1.5 text-[12.5px] leading-snug text-textMuted">
              The banner clients see first.
            </p>
          </div>
        </div>
      ) : (
        <RailEmpty label="Cover" hint="No banner yet — clients see a branded one." />
      )}

      {model.signatureTile ? (
        <div className="mt-4 flex items-start gap-[11px]">
          <span className="block h-[74px] w-[56px] flex-none overflow-hidden rounded-[11px]">
            <RemoteImage
              src={model.signatureTile.src}
              alt=""
              className="h-full w-full object-cover"
              intrinsic
            />
          </span>
          <div>
            <div className="brand-cap text-[8.5px] text-microAccent">Signature</div>
            <p className="mt-1.5 text-[12.5px] leading-snug text-textMuted">
              Your one best piece of work. Sits at the top of your profile.
            </p>
          </div>
        </div>
      ) : (
        <RailEmpty
          label="Signature"
          hint="Publish a photo, then mark it as your best work."
        />
      )}

      <div className="my-[18px] h-px bg-textPrimary/10" />

      {rows.map((row) => (
        <div
          key={row.label}
          className="mt-[9px] flex items-baseline justify-between first:mt-0"
        >
          <span
            className={cn(
              'brand-cap text-[9px]',
              row.gold ? 'text-microAccent' : 'text-textMuted',
            )}
          >
            {row.label}
          </span>
          <span
            className={cn(
              'font-display text-[18px] font-bold',
              row.gold ? 'text-microAccent' : 'text-textPrimary',
            )}
          >
            {formatCompactCount(row.value)}
          </span>
        </div>
      ))}

      {model.publicProfileHref ? (
        <Link
          href={model.publicProfileHref}
          className={cn(
            'brand-focus mt-[18px] flex h-10 w-full items-center justify-center gap-2 rounded-[14px]',
            'border border-textPrimary/10 bg-textPrimary/5 text-[13px] font-bold text-textPrimary',
            'transition hover:border-textPrimary/25',
          )}
        >
          View public profile
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      ) : null}
    </aside>
  )
}

function RailEmpty({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="mt-4 rounded-[14px] border border-dashed border-textPrimary/15 px-3 py-4">
      <div className="brand-cap text-[8.5px] text-textMuted">{label}</div>
      <p className="mt-1.5 text-[12.5px] leading-snug text-textMuted">{hint}</p>
    </div>
  )
}
