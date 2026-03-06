'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { FeedItem } from './lookTypes'

type Props = {
  item: FeedItem
  rightRailBottom: number
  signal: string
  futureSelf: string
}

type ClampStyle = CSSProperties & {
  WebkitLineClamp?: number
  WebkitBoxOrient?: 'vertical' | 'horizontal'
}

function pickTrimmed(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

function formatHelpful(n: number) {
  return `${n} ${n === 1 ? 'helpful' : 'helpfuls'}`
}

function formatRating(r: number) {
  return Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)
}

export default function LookOverlays(props: Props) {
  const { item: m, rightRailBottom, futureSelf } = props

  const pro = m.professional ?? null

  const handle = (pro?.handle ?? '').trim()
  const businessName = (pro?.businessName ?? '').trim()

  const displayHandle = handle ? `@${handle}` : businessName ? businessName : null
  const serviceLabel = pickTrimmed(m.serviceName)
  const caption = pickTrimmed(m.caption)

  // Spotlight / review metadata
  const isReviewSpotlight = Boolean(m.reviewId)
  const reviewHeadline = pickTrimmed(m.reviewHeadline)
  const reviewHelpfulCount = typeof m.reviewHelpfulCount === 'number' ? m.reviewHelpfulCount : null
  const reviewRating = typeof m.reviewRating === 'number' ? m.reviewRating : null

  // Caption behavior:
  // - Spotlight: prefer review headline, fallback to caption
  // - Normal: use caption
  const captionText = isReviewSpotlight ? (reviewHeadline ?? caption) : caption

  // Bottom line behavior:
  // - Spotlight: show rating/helpful meta instead of futureSelf
  // - Normal: keep futureSelf
  const metaParts: string[] = []
  if (reviewRating !== null) metaParts.push(`★ ${formatRating(reviewRating)}`)
  if (reviewHelpfulCount !== null) metaParts.push(formatHelpful(reviewHelpfulCount))
  const spotlightMeta = metaParts.join(' • ')
  const footerLine = isReviewSpotlight ? spotlightMeta : futureSelf

  const hasAnyText = Boolean(displayHandle || serviceLabel || captionText || footerLine)
  if (!hasAnyText) return null

  const profileHref = pro?.id ? `/professionals/${encodeURIComponent(pro.id)}` : null

  const glowTextShadow =
    '0 2px 6px rgba(0,0,0,0.85), 0 0 10px rgb(var(--micro-accent) / 0.28), 0 0 20px rgb(var(--micro-accent) / 0.14)'

  const captionClampStyle: ClampStyle = {
    fontSize: 13,
    fontWeight: 650,
    lineHeight: 1.25,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    opacity: 0.95,
  }

  return (
    <div
      className="absolute z-2 pointer-events-none"
      style={{
        left: 12,
        right: 92,
        bottom: rightRailBottom,
        textShadow: '0 2px 6px rgba(0,0,0,0.88), 0 10px 28px rgba(0,0,0,0.65)',
      }}
    >
      {displayHandle || serviceLabel ? (
        <div className="flex items-center gap-2.5 leading-tight">
          {displayHandle ? (
            profileHref ? (
              <Link
                href={profileHref}
                aria-label={`View profile: ${displayHandle}`}
                className="pointer-events-auto select-none text-white no-underline"
              >
                <span className="text-[14px] font-black hover:opacity-95" style={{ textShadow: glowTextShadow }}>
                  {displayHandle}
                </span>
              </Link>
            ) : (
              <span className="text-[14px] font-black text-white" style={{ textShadow: glowTextShadow }}>
                {displayHandle}
              </span>
            )
          ) : null}

          {displayHandle && serviceLabel ? <span className="text-white opacity-60">•</span> : null}

          {serviceLabel ? <span className="text-[12.5px] font-semibold text-white/90">{serviceLabel}</span> : null}
        </div>
      ) : null}

      {captionText ? (
        <div className="mt-1 text-white" style={captionClampStyle}>
          {isReviewSpotlight && reviewHeadline ? `“${captionText}”` : captionText}
        </div>
      ) : null}

      {footerLine ? <div className="mt-0.5 text-[12px] font-semibold text-white/80">{footerLine}</div> : null}
    </div>
  )
}