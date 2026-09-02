// app/professionals/[id]/_components/PortfolioFeed.tsx
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { resolveDisplayCrop } from '@/lib/media/cropRect'
import { COPY } from '@/lib/copy'
import type { PublicPortfolioTileDto } from '@/lib/profiles/publicProfileMappers'

type PortfolioFeedProps = {
  tiles: PublicPortfolioTileDto[]
  emptyMessage: string
}

const ALL_FILTER = 'All'
const TRANSFORMATIONS_FILTER = 'Transformations'
const VIDEO_FILTER = 'Video'

type FilterRow = {
  label: string
  count: number
  matches: (tile: PublicPortfolioTileDto) => boolean
}

/**
 * The redesigned portfolio: an edge-to-edge feed grid whose tiles are no longer
 * silent — each carries its likes, comments and (when non-zero) how many people
 * recreated it.
 *
 * Client-side because the filter switches in place. It costs no extra request:
 * the whole grid already arrives in one payload, so filtering is a array filter,
 * not a refetch. Every count is computed from the SAME tiles the dropdown
 * filters, so a row can never advertise a count the grid then fails to produce.
 */
export default function PortfolioFeed({
  tiles,
  emptyMessage,
}: PortfolioFeedProps) {
  const [activeFilter, setActiveFilter] = useState(ALL_FILTER)
  const [menuOpen, setMenuOpen] = useState(false)

  const filters = useMemo<FilterRow[]>(() => {
    const rows: FilterRow[] = [
      { label: ALL_FILTER, count: tiles.length, matches: () => true },
      {
        // A paired post IS the transformation — the before/after is the pairing,
        // not a tag someone remembered to apply.
        label: TRANSFORMATIONS_FILTER,
        count: 0,
        matches: (tile) => tile.before !== null,
      },
      { label: VIDEO_FILTER, count: 0, matches: (tile) => tile.isVideo },
    ]

    // Service tags, in first-seen order, so the list reads like the pro's own
    // work rather than an alphabetised taxonomy.
    const serviceNames: string[] = []
    for (const tile of tiles) {
      for (const name of tile.serviceNames) {
        if (!serviceNames.includes(name)) serviceNames.push(name)
      }
    }

    for (const name of serviceNames) {
      rows.push({
        label: name,
        count: 0,
        matches: (tile) => tile.serviceNames.includes(name),
      })
    }

    // Count once, from the real predicate — a hand-maintained count is how a
    // filter ends up promising rows it cannot show.
    return rows
      .map((row) =>
        row.label === ALL_FILTER
          ? row
          : { ...row, count: tiles.filter(row.matches).length },
      )
      .filter((row) => row.count > 0)
  }, [tiles])

  const active =
    filters.find((row) => row.label === activeFilter) ?? filters[0] ?? null

  const visible = useMemo(
    () => (active ? tiles.filter(active.matches) : tiles),
    [active, tiles],
  )

  if (tiles.length === 0) {
    return (
      <div className="brand-pp-card mt-4 p-4 text-[13px] text-textSecondary">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div>
      {/* One real choice is not a choice — the dropdown only appears once the
          pro's work actually splits into more than one bucket. */}
      {filters.length > 1 ? (
        <div className="relative mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            className="brand-pp-filter brand-focus"
            aria-expanded={menuOpen}
            aria-haspopup="listbox"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {active?.label ?? ALL_FILTER}
            <span aria-hidden="true">▾</span>
          </button>

          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-textMuted">
            Newest first
          </span>

          {menuOpen ? (
            <div className="brand-pp-filter-menu" role="listbox">
              {filters.map((row) => (
                <button
                  key={row.label}
                  type="button"
                  role="option"
                  aria-selected={row.label === active?.label}
                  data-active={row.label === active?.label ? 'true' : 'false'}
                  className="brand-pp-filter-row brand-focus"
                  onClick={() => {
                    setActiveFilter(row.label)
                    setMenuOpen(false)
                  }}
                >
                  <span>{row.label}</span>
                  <span className="text-textMuted">{row.count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="brand-pp-grid">
        {visible.map((tile) => (
          <PortfolioTile key={tile.id} tile={tile} />
        ))}
      </div>
    </div>
  )
}

function tileHref(tile: PublicPortfolioTileDto): string {
  // §19f — a portfolio tile IS a look, so open the look detail (the feed post
  // with its engagement). Fall back to the media page for the rare tile with no
  // backing look.
  return tile.lookId
    ? `/looks/${encodeURIComponent(tile.lookId)}`
    : `/media/${encodeURIComponent(tile.id)}`
}

function PortfolioTile({ tile }: { tile: PublicPortfolioTileDto }) {
  const title = tile.caption ?? 'Open portfolio post'
  const { engagement } = tile
  // One crop per look, honoured HERE too — not just in the feed. The rect is the
  // frame the pro published; a tile that derives its own 3:4 window from the
  // master would show a look one shape here and another in the feed.
  const { cropRect, focalPoint } = resolveDisplayCrop(tile)

  return (
    <Link
      href={tileHref(tile)}
      className="brand-pp-tile brand-focus group block"
      title={title}
      aria-label={title}
    >
      <RemoteImage
        src={tile.src}
        alt={tile.caption ?? 'Portfolio'}
        className="brand-pp-tile-img transition duration-200 group-hover:scale-[1.02]"
        focalPoint={focalPoint}
        cropRect={cropRect}
        intrinsic
      />

      <span className="brand-pp-tile-scrim" aria-hidden />

      {/* Zero recreates render NOTHING — never a "0". */}
      {engagement.recreatedCount > 0 ? (
        <span
          className="brand-pp-tile-flag"
          data-side="left"
          title={`${engagement.recreatedCount} ${COPY.publicProfile.recreatedSuffix}`}
        >
          <span aria-hidden="true">↺</span>
          {engagement.recreatedCount}
          <span className="sr-only">
            {' '}
            {COPY.publicProfile.recreatedSuffix}
          </span>
        </span>
      ) : null}

      {tile.before ? (
        <span className="brand-pp-tile-flag" data-side="right">
          B / A
        </span>
      ) : tile.isVideo ? (
        <span className="brand-pp-tile-flag" data-side="right">
          <span aria-hidden="true">▶</span>
          <span className="sr-only">Video</span>
        </span>
      ) : null}

      <span className="brand-pp-tile-counts">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="text-[rgb(var(--color-ember))]">
            ♥
          </span>
          {engagement.likeCount}
          <span className="sr-only"> likes</span>
        </span>

        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true">💬</span>
          {engagement.commentCount}
          <span className="sr-only"> comments</span>
        </span>
      </span>
    </Link>
  )
}
