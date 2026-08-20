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
  Flag,
} from 'lucide-react'

import RemoteImage from '@/app/_components/media/RemoteImage'
import SaveToBoardModal from './SaveToBoardModal'
import { formatCompactCount } from '@/lib/format/compactCount'
import type { LookReportResult } from './reportLookPost'
import { REPORT_LABEL, type ReportState } from './reportState'
import type { LooksSaveStateResponseDto } from '@/lib/looks/types'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'

const TEXT_SHADOW =
  '0 2px 20px rgba(0,0,0,0.85), 0 1px 4px rgba(0,0,0,0.9)'
const PAPER = 'rgb(var(--text-primary) / 1)'
const EMBER = 'rgb(var(--color-ember))'
const ACID = 'rgb(var(--color-acid))'

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
  // Report the LOOK itself (App Store guideline 1.2 — the photo is the likelier
  // objectionable object in a beauty app, and the comment path already had a
  // report). Absent → the control isn't rendered, which is how an owner-viewed
  // surface suppresses it.
  onReport?: () => Promise<LookReportResult>
  onSaveStateChange?: (state: LooksSaveStateResponseDto) => void
}

function RailButton({
  children,
  count,
  label,
  onClick,
  ariaLabel,
  testId,
  disabled = false,
}: {
  children: React.ReactNode
  count?: number | null
  label?: string
  onClick: () => void
  ariaLabel: string
  testId?: string
  disabled?: boolean
}) {
  const footerText =
    label ??
    (typeof count === 'number' && count > 0 ? formatCompactCount(count) : null)

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
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
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
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
  onReport,
  onSaveStateChange,
}: RightActionRailProps) {
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [saved, setSaved] = useState(viewerSaved)
  const [reportState, setReportState] = useState<ReportState>('idle')

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

  // Fire-and-settle, mirroring the comment row: the route is idempotent by
  // unique constraint so a repeat is a 200 rather than an error, but there is
  // no server-side rate limit — leaving `idle` IS the debounce, and the button
  // is disabled for anything but `idle`. A failure falls back to "Report" so it
  // stays visible and retryable rather than hijacking the surface with an error.
  async function handleReport() {
    if (!onReport || reportState !== 'idle') return
    setReportState('pending')
    const result = await onReport()
    setReportState(result === 'ok' ? 'done' : 'idle')
  }

  return (
    <>
      <div
        className="absolute z-[80] select-none"
        style={{
          right,
          bottom,
          display: 'grid',
          // 16, not the original 18: the rail grows UPWARD from `bottom`, and
          // adding the Report control made it 57px taller, which pushed the
          // poster avatar off the top of a 568px-tall viewport (measured
          // before/after: railTop +43 → −14). Tightening the seven gaps by 2px
          // each gives back exactly that 14px. Imperceptible at a glance, and it
          // keeps every control — and the avatar — on screen at 320×568.
          gap: 16,
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
                  boxShadow: '0 4px 12px rgb(var(--shadow-color) / 0.6)',
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
                '0 8px 24px rgb(var(--accent-primary) / 0.55), 0 2px 6px rgb(var(--shadow-color) / 0.6)',
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

        {onReport ? (
          <RailButton
            // Idle gets the more descriptive name (a lone flag icon does not
            // say WHAT it reports); once acting, the accessible name tracks the
            // visible label so the two never disagree.
            ariaLabel={
              reportState === 'idle'
                ? 'Report this look'
                : REPORT_LABEL[reportState]
            }
            testId="report-look-button"
            label={REPORT_LABEL[reportState]}
            onClick={() => void handleReport()}
            disabled={reportState !== 'idle'}
          >
            <Flag size={26} style={{ color: PAPER }} />
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