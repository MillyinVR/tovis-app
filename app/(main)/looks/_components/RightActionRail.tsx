// app/(main)/looks/_components/RightActionRail.tsx
'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { CalendarDays, Heart, MessageCircle, Share2 } from 'lucide-react'

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function formatCount(n: number) {
  const v = clamp(n, 0, 999999)
  if (v >= 100000) return `${Math.round(v / 1000)}K`
  if (v >= 10000) return `${(v / 1000).toFixed(1)}K`
  return String(v)
}

type ProMini = {
  id: string
  businessName: string | null
  avatarUrl?: string | null
} | null

const GAP = 18
const AVATAR_SIZE = 56 // TikTok-ish anchor size
const ICON_SIZE = 24

export default function RightActionRail({
  pro,
  viewerLiked,
  likeCount,
  commentCount,
  right = 12,
  bottom = 150,
  onOpenAvailability,
  onToggleLike,
  onOpenComments,
  onShare,
}: {
  pro: ProMini
  viewerLiked: boolean
  likeCount: number
  commentCount: number
  right?: number
  bottom?: number
  onOpenAvailability: () => void
  onToggleLike: () => void
  onOpenComments: () => void
  onShare: () => void
}) {
  function IconButton({
    icon,
    count,
    onClick,
    ariaLabel,
    hideZero = false,
  }: {
    icon: ReactNode
    count?: number
    onClick: () => void
    ariaLabel: string
    hideZero?: boolean
  }) {
    const showCount = typeof count === 'number' && (!hideZero || count > 0)

    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        title={ariaLabel}
        style={{ all: 'unset' as any }}
        className="grid cursor-pointer justify-items-center gap-1 text-center transition-transform active:scale-95 md:hover:scale-[1.03]"
      >
        <div
          className="grid place-items-center"
          style={{
            filter:
              'brightness(1.75) drop-shadow(0 0 10px rgba(255,255,255,0.9)) drop-shadow(0 10px 22px rgba(0,0,0,0.95))',
          }}
        >
          {icon}
        </div>

        {showCount ? (
          <div
            className="w-full text-center text-[12px] font-extrabold tracking-wide text-white/95"
            style={{ textShadow: '0 2px 10px rgba(0,0,0,0.9)' }}
          >
            {formatCount(count!)}
          </div>
        ) : (
          <div className="h-[14px]" />
        )}
      </button>
    )
  }

  return (
    <div
      className="absolute z-[80] select-none"
      style={{
        right,
        bottom,
        display: 'grid',
        gap: GAP,
        justifyItems: 'center',
      }}
    >
      {/* Pro avatar (ONLY thing with a circle) */}
      {pro?.id ? (
        <Link
          href={`/professionals/${encodeURIComponent(pro.id)}`}
          aria-label="View professional profile"
          className="grid justify-items-center"
          style={{ textDecoration: 'none' }}
        >
          <div className="relative transition-transform active:scale-95 md:hover:scale-[1.03]">
            <div
              className="overflow-hidden rounded-full bg-white/10"
              style={{
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                border: '2px solid rgba(255,255,255,0.35)',
                boxShadow:
                  '0 10px 30px rgba(0,0,0,0.65), 0 0 18px rgba(255,255,255,0.18)',
                backdropFilter: 'blur(18px)',
                WebkitBackdropFilter: 'blur(18px)',
              }}
            >
              {pro.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pro.avatarUrl}
                  alt={pro.businessName || 'Professional'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-[18px] font-black text-white">
                  {(pro.businessName || 'P').slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>

            {/* Plus badge */}
            <div
              className="absolute left-1/2 grid place-items-center rounded-full font-black"
              style={{
                width: 22,
                height: 22,
                bottom: -7,
                transform: 'translateX(-50%)',
                background: 'rgb(var(--accent-primary) / 1)',
                color: 'rgb(var(--bg-primary) / 1)',
                boxShadow: '0 8px 18px rgba(0,0,0,0.6)',
              }}
            >
              +
            </div>
          </div>
        </Link>
      ) : (
        <div
          className="rounded-full bg-white/10"
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            border: '2px solid rgba(255,255,255,0.25)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.65)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
          }}
        />
      )}

      {/* Availability */}
      <IconButton
        ariaLabel="Check availability"
        onClick={onOpenAvailability}
        icon={<CalendarDays size={ICON_SIZE} className="text-white" />}
      />

      {/* Like */}
      <IconButton
        ariaLabel={viewerLiked ? 'Unlike' : 'Like'}
        onClick={onToggleLike}
        count={likeCount}
        hideZero
        icon={
          <Heart
            size={ICON_SIZE}
            className={
              viewerLiked
                ? 'fill-[rgb(var(--micro-accent))] text-[rgb(var(--micro-accent))]'
                : 'text-white'
            }
            style={{
              filter: viewerLiked
                ? 'brightness(1.9) drop-shadow(0 0 14px rgba(255,90,120,0.95)) drop-shadow(0 10px 22px rgba(0,0,0,0.95))'
                : undefined,
            }}
          />
        }
      />

      {/* Comments */}
      <IconButton
        ariaLabel="Open comments"
        onClick={onOpenComments}
        count={commentCount}
        hideZero
        icon={<MessageCircle size={ICON_SIZE} className="text-white" />}
      />

      {/* Share */}
      <IconButton
        ariaLabel="Share"
        onClick={onShare}
        icon={<Share2 size={ICON_SIZE} className="text-white" />}
      />
    </div>
  )
}
