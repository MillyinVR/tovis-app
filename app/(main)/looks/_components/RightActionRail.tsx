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
  EyeOff,
} from 'lucide-react'

import RemoteImage from '@/app/_components/media/RemoteImage'
import SaveToBoardModal from './SaveToBoardModal'
import type { LooksSaveStateResponseDto } from '@/lib/looks/types'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'

const TEXT_SHADOW =
  '0 2px 20px rgba(0,0,0,0.85), 0 1px 4px rgba(0,0,0,0.9)'
const PAPER = 'rgb(var(--text-primary) / 1)'
const EMBER = 'rgb(var(--color-ember))'
const ACID = 'rgb(var(--color-acid))'

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
  firstName?: string | null
  lastName?: string | null
  avatarUrl?: string | null
} | null

type ClientAuthorMini = {
  handle: string
  avatarUrl: string | null
  profileHref: string | null
} | null

type RightActionRailProps = {
  lookPostId: string
  lookTitle?: string | null
  viewerSaved?: boolean
  pro: ProMini
  clientAuthor?: ClientAuthorMini
  viewerLiked: boolean
  likeCount: number
  commentCount: number
  right?: number
  bottom?: number
  onOpenAvailability: () => void
  onToggleLike: () => void
  onOpenComments: () => void
  onShare: () => void
  // One-tap "not for me" hide (spec §2.2). Absent → the control isn't rendered.
  onHide?: () => void
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
  clientAuthor = null,
  viewerLiked,
  likeCount,
  commentCount,
  right = 10,
  bottom = 130,
  onOpenAvailability,
  onToggleLike,
  onOpenComments,
  onShare,
  onHide,
  onSaveStateChange,
}: RightActionRailProps) {
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [saved, setSaved] = useState(viewerSaved)

  // The rail avatar credits the poster: the publishing client on a
  // client-authored look (server-resolved link — /u/[handle], or the pro chart
  // for an authorized pro viewer), otherwise the pro.
  const posterHref = clientAuthor
    ? clientAuthor.profileHref
    : pro?.id
      ? `/professionals/${encodeURIComponent(pro.id)}`
      : null
  const posterLabel = clientAuthor
    ? `@${clientAuthor.handle}`
    : pro
      ? formatProfessionalPublicDisplayName(pro)
      : ''
  const posterAvatarUrl = clientAuthor
    ? clientAuthor.avatarUrl
    : pro?.avatarUrl ?? null
  const posterAriaLabel = clientAuthor
    ? `View profile: ${posterLabel}`
    : 'View professional profile'

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
        {posterHref ? (
          <Link
            href={posterHref}
            aria-label={posterAriaLabel}
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
                  border: '2px solid rgb(var(--surface-glass) / 0.4)',
                  overflow: 'hidden',
                  background: 'rgb(var(--surface-glass) / 0.08)',
                }}
              >
                {posterAvatarUrl ? (
                  <RemoteImage
                    src={posterAvatarUrl}
                    alt={posterLabel}
                    width={48}
                    height={48}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
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
                    {initialLetter(posterLabel)}
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
                  background: 'rgb(var(--accent-primary))',
                  color: 'rgb(var(--text-primary))',
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
              border: '2px solid rgb(var(--surface-glass) / 0.25)',
              background: 'rgb(var(--surface-glass) / 0.06)',
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
              background: 'rgb(var(--accent-primary))',
              color: 'rgb(var(--text-primary))',
              display: 'grid',
              placeItems: 'center',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              boxShadow:
                '0 8px 24px rgb(var(--accent-primary) / 0.55), 0 2px 6px rgba(0,0,0,0.6)',
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

        {onHide ? (
          <RailButton
            ariaLabel="Not for me"
            testId="hide-look-button"
            onClick={onHide}
          >
            <EyeOff size={26} style={{ color: PAPER }} />
          </RailButton>
        ) : null}
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