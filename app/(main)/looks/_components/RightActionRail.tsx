// app/(main)/looks/_components/RightActionRail.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Bookmark,
  Heart,
  MessageCircle,
  Upload,
  CalendarDays,
} from 'lucide-react'

import SaveToBoardModal from './SaveToBoardModal'
import type { LooksSaveStateResponseDto } from '@/lib/looks/types'

const TEXT_SHADOW =
  '0 2px 20px rgba(0,0,0,0.85), 0 1px 4px rgba(0,0,0,0.9)'
const PAPER = 'rgba(244,239,231,1)'
const EMBER = '#FF3D4E'
const ACID = '#D4FF3A'

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function formatCount(n: number) {
  const v = clamp(n, 0, 999_999)
  if (v >= 100_000) return `${Math.round(v / 1000)}K`
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}K`
  return String(v)
}

function initialLetter(name: string | null) {
  const s = (name || '').trim()
  return (s ? s.slice(0, 1) : 'P').toUpperCase()
}

type ProMini = {
  id: string
  businessName: string | null
  avatarUrl?: string | null
} | null

type RightActionRailProps = {
  lookPostId: string
  lookTitle?: string | null
  viewerSaved?: boolean
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
  onSaveStateChange?: (state: LooksSaveStateResponseDto) => void
}

function RailButton({
  children,
  count,
  label,
  onClick,
  ariaLabel,
  testId,
}: {
  children: React.ReactNode
  count?: number | null
  label?: string
  onClick: () => void
  ariaLabel: string
  testId?: string
}) {
  const footerText =
    label ??
    (typeof count === 'number' && count > 0 ? formatCount(count) : null)

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{
        display: 'grid',
        justifyItems: 'center',
        gap: 2,
        background: 'transparent',
        border: 'none',
        padding: 0,
        margin: 0,
        cursor: 'pointer',
      }}
      className="active:scale-95 transition-transform"
    >
      <div style={{ textShadow: TEXT_SHADOW }}>{children}</div>
      {footerText ? (
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: PAPER,
            textShadow: TEXT_SHADOW,
            lineHeight: 1,
          }}
        >
          {footerText}
        </div>
      ) : (
        <div style={{ height: 14 }} />
      )}
    </button>
  )
}

export default function RightActionRail({
  lookPostId,
  lookTitle = null,
  viewerSaved = false,
  pro,
  viewerLiked,
  likeCount,
  commentCount,
  right = 10,
  bottom = 130,
  onOpenAvailability,
  onToggleLike,
  onOpenComments,
  onShare,
  onSaveStateChange,
}: RightActionRailProps) {
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [saved, setSaved] = useState(viewerSaved)

  useEffect(() => {
    setSaved(viewerSaved)
  }, [viewerSaved])

  function handleSaveStateChange(state: LooksSaveStateResponseDto) {
    setSaved(state.isSaved)
    onSaveStateChange?.(state)
  }

  return (
    <>
      <div
        className="absolute z-[80] select-none"
        style={{
          right,
          bottom,
          display: 'grid',
          gap: 18,
          justifyItems: 'center',
        }}
      >
        {pro?.id ? (
          <Link
            href={`/professionals/${encodeURIComponent(pro.id)}`}
            aria-label="View professional profile"
            style={{
              display: 'grid',
              justifyItems: 'center',
              textDecoration: 'none',
            }}
            className="active:scale-95 transition-transform"
          >
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  border: '2px solid rgba(244,239,231,0.4)',
                  overflow: 'hidden',
                  background: 'rgba(244,239,231,0.08)',
                }}
              >
                {pro.avatarUrl ? (
                  <img
                    src={pro.avatarUrl}
                    alt={pro.businessName || 'Professional'}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 18,
                      fontWeight: 900,
                      color: PAPER,
                    }}
                  >
                    {initialLetter(pro.businessName)}
                  </div>
                )}
              </div>

              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  bottom: -6,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#E05A28',
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 900,
                  fontSize: 14,
                  lineHeight: 1,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
                }}
              >
                +
              </div>
            </div>
          </Link>
        ) : (
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              border: '2px solid rgba(244,239,231,0.25)',
              background: 'rgba(244,239,231,0.06)',
            }}
          />
        )}

        <div style={{ display: 'grid', justifyItems: 'center', gap: 0 }}>
          <button
            type="button"
            data-testid="open-availability-button"
            onClick={onOpenAvailability}
            aria-label="Book"
            className="book-glow active:scale-95 transition-transform"
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: '#E05A28',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              boxShadow:
                '0 8px 24px rgba(224,90,40,0.55), 0 2px 6px rgba(0,0,0,0.6)',
            }}
          >
            <CalendarDays size={30} aria-hidden="true" />
          </button>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: PAPER,
              textShadow: TEXT_SHADOW,
              marginTop: -2,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.06em',
            }}
          >
            BOOK
          </div>
        </div>

        <RailButton
          ariaLabel={viewerLiked ? 'Unlike' : 'Like'}
          onClick={onToggleLike}
          count={likeCount}
        >
          <Heart
            size={30}
            style={{
              color: viewerLiked ? EMBER : PAPER,
              fill: viewerLiked ? EMBER : 'none',
              transition: 'color 0.15s ease, fill 0.15s ease',
            }}
          />
        </RailButton>

        <RailButton
          ariaLabel="Open comments"
          onClick={onOpenComments}
          count={commentCount}
        >
          <MessageCircle size={30} style={{ color: PAPER }} />
        </RailButton>

        <RailButton
          ariaLabel={saved ? 'Manage saved boards' : 'Save to board'}
          onClick={() => setIsSaveModalOpen(true)}
        >
          <Bookmark
            size={30}
            style={{
              color: saved ? ACID : PAPER,
              fill: saved ? ACID : 'none',
              transition: 'color 0.15s ease, fill 0.15s ease',
            }}
          />
        </RailButton>

        <RailButton ariaLabel="Share" onClick={onShare}>
          <Upload size={28} style={{ color: PAPER }} />
        </RailButton>
      </div>

      <SaveToBoardModal
        isOpen={isSaveModalOpen}
        lookPostId={lookPostId}
        title={lookTitle}
        onClose={() => setIsSaveModalOpen(false)}
        onSaveStateChange={handleSaveStateChange}
      />
    </>
  )
}