// app/_components/boards/BoardStripCard.tsx
'use client'

import Link from 'next/link'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { COPY } from '@/lib/copy'

/**
 * The wide board strip, shared by the PUBLIC creator profile and the client's
 * OWN boards screen so a board looks like the same object to its owner and to a
 * visitor. It used to be a square 2×2 mosaic on the owner's side and a strip on
 * the public side — the same board reading as two different things depending on
 * who was looking.
 *
 * The only differences the two surfaces get are the ones that are actually
 * different: the owner sees whether a board is shared, and can change it.
 */
export type BoardStripCardProps = {
  href: string
  name: string
  itemCount: number
  /** Up to four cover tiles; fewer is fine and narrows the strip honestly. */
  tileImageUrls: string[]
  /**
   * Owner surfaces only. On the public profile every listed board is shared by
   * definition, so a badge there would be true of every row and tell the
   * visitor nothing.
   *
   * ⚠️ Ignored when {@link action} is present — see the render below.
   */
  shared?: boolean
  /** Rendered over the strip's right side — the owner's visibility control. */
  action?: React.ReactNode
}

export default function BoardStripCard({
  href,
  name,
  itemCount,
  tileImageUrls,
  shared,
  action,
}: BoardStripCardProps) {
  const tiles = tileImageUrls.slice(0, 4)

  // The visibility switch already SAYS "Shared", eight pixels above this line —
  // rendering the badge too printed the same fact about the same board twice on
  // every owner card. The control wins: it states the value AND changes it,
  // which a badge cannot. Surfaces with no control (the public profile passes
  // no `action`) still get the badge.
  const showSharedBadge = Boolean(shared) && !action

  return (
    <div className="relative">
      <Link
        href={href}
        className="group relative block aspect-[2.05/1] overflow-hidden rounded-[18px] border border-textPrimary/10 bg-bgSecondary brand-focus"
      >
        {/* One column per look the board ACTUALLY has, capped at four. A fixed
            four-column strip leaves dead cells on a board with two looks, which
            reads as a broken image rather than as a small board. The explicit
            row track is load-bearing: without it the cells have no resolved
            height for `h-full` to fill and each tile falls back to its own
            aspect ratio. */}
        <div
          className="absolute inset-0 grid grid-rows-1"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, tiles.length))}, 1fr)`,
          }}
        >
          {tiles.map((url, index) => (
            <div key={index} className="relative overflow-hidden bg-bgPrimary">
              <RemoteImage
                src={url}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
                width={320}
                height={320}
              />
            </div>
          ))}
        </div>

        {/* Left-weighted so the name has a dark field to sit on while the
            right-hand looks stay legible. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-linear-to-r from-bgPrimary/85 from-28% via-bgPrimary/25 via-70% to-transparent"
        />

        <div className="absolute inset-x-3.5 bottom-3.5">
          <div className="truncate text-[17px] font-bold tracking-[-0.02em] text-textPrimary">
            {name}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em]">
            <span className="text-textSecondary">
              {itemCount}{' '}
              {itemCount === 1
                ? COPY.publicProfile.boardLooksOne
                : COPY.publicProfile.boardLooksMany}
            </span>
            {showSharedBadge ? (
              <>
                <span aria-hidden="true" className="text-textSecondary/50">
                  ·
                </span>
                <span data-testid="board-shared-badge" className="text-toneWarn">
                  {COPY.boards.sharedBadge}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </Link>

      {/* Outside the Link: a control inside an anchor is not operable by
          keyboard as its own target, and tapping it would navigate. */}
      {action ? (
        <div className="absolute right-3 top-3 z-10">{action}</div>
      ) : null}
    </div>
  )
}
