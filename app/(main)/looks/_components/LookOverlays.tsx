'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { FeedItem } from './lookTypes'

const TEXT_SHADOW = '0 2px 20px rgba(0,0,0,0.85), 0 1px 4px rgba(0,0,0,0.9)'
const PAPER = 'rgba(244,239,231,1)'

type ClampStyle = CSSProperties & {
  WebkitLineClamp?: number
  WebkitBoxOrient?: 'vertical' | 'horizontal'
}

type Props = {
  item: FeedItem
  rightRailBottom: number
  signal: string
  futureSelf: string
}

function pickTrimmed(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

function formatRating(r: number) {
  return Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)
}

function formatHelpful(n: number) {
  return `${n} ${n === 1 ? 'helpful' : 'helpfuls'}`
}

export default function LookOverlays({ item: m, rightRailBottom }: Props) {
  const pro = m.professional ?? null

  const businessName = (pro?.businessName ?? '').trim()
  const handle = (pro?.handle ?? '').trim()
  const displayName = businessName || (handle ? `@${handle}` : null)

  const serviceLabel = pickTrimmed(m.serviceName)
  const caption = pickTrimmed(m.caption)

  const isReviewSpotlight = Boolean(m.reviewId)
  const reviewHeadline = pickTrimmed(m.reviewHeadline)
  const reviewHelpfulCount = typeof m.reviewHelpfulCount === 'number' ? m.reviewHelpfulCount : null
  const reviewRating = typeof m.reviewRating === 'number' ? m.reviewRating : null

  // Spotlight uses review headline as the caption quote
  const captionText = isReviewSpotlight ? (reviewHeadline ?? caption) : caption

  const profileHref = pro?.id ? `/professionals/${encodeURIComponent(pro.id)}` : null

  const hasAnyContent = Boolean(displayName || captionText || serviceLabel)
  if (!hasAnyContent) return null

  const captionStyle: ClampStyle = {
    fontFamily: 'var(--font-display-face, "Fraunces"), Georgia, serif',
    fontStyle: 'italic',
    fontSize: 18,
    lineHeight: 1.3,
    color: PAPER,
    marginBottom: 10,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }

  // Spotlight rating line shown below service pill
  const metaParts: string[] = []
  if (reviewRating !== null) metaParts.push(`★ ${formatRating(reviewRating)}`)
  if (reviewHelpfulCount !== null) metaParts.push(formatHelpful(reviewHelpfulCount))
  const spotlightMeta = metaParts.join(' • ')

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: 16,
        right: 92,
        bottom: rightRailBottom,
        zIndex: 25,
        textShadow: TEXT_SHADOW,
      }}
    >
      {/* Row 1: Pro name + FOLLOW pill */}
      {displayName ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {profileHref ? (
            <Link
              href={profileHref}
              aria-label={`View profile: ${displayName}`}
              className="pointer-events-auto no-underline"
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: PAPER }}>
                {displayName}
              </span>
            </Link>
          ) : (
            <span style={{ fontSize: 15, fontWeight: 700, color: PAPER }}>
              {displayName}
            </span>
          )}

          <div
            className="pointer-events-auto"
            style={{
              padding: '2px 8px',
              border: '1px solid rgba(244,239,231,0.35)',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: PAPER,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              flexShrink: 0,
            }}
          >
            FOLLOW
          </div>
        </div>
      ) : null}

      {/* Row 2: Italic serif caption with quotes */}
      {captionText ? (
        <div style={captionStyle}>
          &ldquo;{captionText}&rdquo;
        </div>
      ) : null}

      {/* Row 3: Pills */}
      {(serviceLabel || spotlightMeta) ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {serviceLabel ? (
            <div
              style={{
                padding: '4px 10px',
                background: 'rgba(20,17,14,0.65)',
                border: '1px solid rgba(244,239,231,0.18)',
                borderRadius: 999,
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '0.08em',
                textTransform: 'uppercase' as const,
                color: 'rgba(244,239,231,0.9)',
              }}
            >
              {serviceLabel}
            </div>
          ) : null}

          {isReviewSpotlight && spotlightMeta ? (
            <div
              style={{
                padding: '4px 10px',
                background: 'rgba(20,17,14,0.65)',
                border: '1px solid rgba(244,239,231,0.18)',
                borderRadius: 999,
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '0.08em',
                color: 'rgba(244,239,231,0.75)',
              }}
            >
              {spotlightMeta}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
