// app/(main)/looks/_components/LookSlide.tsx
'use client'

import type { ReactNode } from 'react'
import LookMedia from './LookMedia'
import LookOverlays from './LookOverlays'

type FeedItem = {
  id: string
  url: string
  mediaType: 'IMAGE' | 'VIDEO'
  caption: string | null
  professional: { id: string; businessName: string | null; handle?: string | null; avatarUrl?: string | null } | null
  _count: { likes: number; comments: number }
  viewerLiked: boolean
  serviceId?: string | null
  serviceName?: string | null
  category?: string | null
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
  const {
    index,
    item,
    isActive,
    rightRailBottom,
    signal,
    futureSelf,
    onDoubleClickLike,
    onTouchEndLike,
    onToggleLike,
    onOpenComments,
    onOpenAvailability,
    rightRail,
  } = props

  return (
    <article
      data-look-slide="1"
      data-index={index}
      className="relative bg-bgPrimary"
      style={{
        height: '100%',
        scrollSnapAlign: 'start',
        scrollSnapStop: 'always',
      }}
      onDoubleClick={onDoubleClickLike}
      onTouchEnd={onTouchEndLike}
    >
      {/* Stage: mobile full-bleed, desktop centered */}
      <div className="relative h-full w-full">
        <div className="mx-auto h-full w-full max-w-[560px] md:max-w-[520px] lg:max-w-[560px] xl:max-w-[600px]">
          <div className="relative h-full w-full overflow-hidden md:rounded-[18px]">
            <LookMedia item={item} isActive={isActive} />

            <LookOverlays item={item} rightRailBottom={rightRailBottom} signal={signal} futureSelf={futureSelf} />

            {/* ✅ Render rail directly (NO wrapper). RightActionRail is already absolute. */}
            {rightRail}
          </div>
        </div>

        {/* Desktop side fades */}
        <div className="pointer-events-none absolute inset-0 hidden md:block">
          <div className="absolute inset-y-0 left-0 w-[12vw] bg-gradient-to-r from-bgPrimary to-transparent" />
          <div className="absolute inset-y-0 right-0 w-[12vw] bg-gradient-to-l from-bgPrimary to-transparent" />
        </div>
      </div>
    </article>
  )
}
