// app/(main)/looks/_components/LookSlide.tsx
'use client'

import type { ReactNode } from 'react'
import LookMedia from './LookMedia'
import LookOverlays from './LookOverlays'
import type { FeedItem } from './lookTypes'

function formatHelpful(n: number) {
  return `${n} ${n === 1 ? 'helpful' : 'helpfuls'}`
}

function formatRating(r: number) {
  // Show cleanly (4 vs 4.5)
  return Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)
}

function pickNonEmpty(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

export default function LookSlide(props: {
  index: number
  item: FeedItem
  isActive: boolean
  rightRailBottom: number
  signal: string
  futureSelf: string

  onDoubleClickLike: () => void
  onTouchEndLike: () => void
  onToggleLike: () => void
  onOpenComments: () => void
  onOpenAvailability: () => void

  rightRail?: ReactNode
}) {
  const { index, item, isActive, rightRailBottom, signal, futureSelf, onDoubleClickLike, onTouchEndLike, rightRail } = props

  const isReviewSpotlight = Boolean(item.reviewId)

  const helpfulCount = typeof item.reviewHelpfulCount === 'number' ? item.reviewHelpfulCount : null
  const rating = typeof item.reviewRating === 'number' ? item.reviewRating : null
  const headline = pickNonEmpty(item.reviewHeadline)

  const metaParts: string[] = []
  if (rating !== null) metaParts.push(`★ ${formatRating(rating)}`)
  if (helpfulCount !== null) metaParts.push(formatHelpful(helpfulCount))
  if (headline) metaParts.push(`“${headline}”`)
  const metaLine = metaParts.join(' • ')

  // Position badge below the fixed top bar (safe-area aware)
  const spotlightTop = 'calc(env(safe-area-inset-top, 0px) + 64px)'

  return (
    <article
      data-look-slide="1"
      data-index={index}
      className="relative bg-bgPrimary"
      style={{ height: '100%', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}
      onDoubleClick={onDoubleClickLike}
      onTouchEnd={onTouchEndLike}
    >
      <div className="relative h-full w-full">
        <div className="mx-auto h-full w-full max-w-560px md:max-w-520px lg:max-w-560px xl:max-w-600px">
          <div className="relative h-full w-full overflow-hidden md:rounded-[18px]">
            <LookMedia item={item} isActive={isActive} />

            {/* Bottom fade — matches footer bg so media dissolves into the nav bar */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 260,
                background: 'linear-gradient(to top, rgba(10,9,7,0.92) 0%, rgba(10,9,7,0.4) 45%, transparent 100%)',
                pointerEvents: 'none',
                zIndex: 5,
              }}
            />

            {/* Review Spotlight badge */}
            {isReviewSpotlight ? (
              <div className="pointer-events-none absolute left-3 right-3 z-30" style={{ top: spotlightTop }}>
                <div
                  className="inline-flex max-w-full flex-col gap-0.5 rounded-2xl border border-white/10 bg-black/35 px-3 py-2 backdrop-blur-md"
                  style={{ boxShadow: '0 10px 26px rgba(0,0,0,0.35)' }}
                >
                  <div className="text-[12px] font-black tracking-tight text-white">Review Spotlight</div>
                  {metaLine ? (
                    <div className="truncate text-[11px] font-semibold text-white/80">{metaLine}</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <LookOverlays item={item} rightRailBottom={rightRailBottom} signal={signal} futureSelf={futureSelf} />
            {rightRail}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 hidden md:block">
          <div className="absolute inset-y-0 left-0 w-[12vw] bg-linear-to-r from-bgPrimary to-transparent" />
          <div className="absolute inset-y-0 right-0 w-[12vw] bg-linear-to-l from-bgPrimary to-transparent" />
        </div>
      </div>
    </article>
  )
}