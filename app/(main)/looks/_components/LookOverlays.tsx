// app/(main)/looks/_components/LookOverlays.tsx
'use client'

import Link from 'next/link'

type FeedItem = {
  id: string
  caption: string | null
  professional: {
    id: string
    businessName: string | null
    handle?: string | null
    professionType?: string | null
    avatarUrl?: string | null
  } | null
  _count: { likes: number; comments: number }
  viewerLiked: boolean
  serviceId?: string | null
  serviceName?: string | null
}

export default function LookOverlays(props: {
  item: FeedItem
  rightRailBottom: number
  signal: string
  futureSelf: string
}) {
  const { item: m, rightRailBottom, futureSelf } = props
  const pro = m.professional

  const handle = (pro?.handle || '').trim()
  const businessName = (pro?.businessName || '').trim()

  const displayHandle = handle ? `@${handle}` : businessName ? businessName : null
  const serviceLabel = (m.serviceName || '').trim() || null

  const hasAnyText = Boolean(displayHandle || serviceLabel || m.caption || futureSelf)
  if (!hasAnyText) return null

  return (
    <div
      className="absolute z-[2]"
      style={{
        left: 12,
        right: 92,
        bottom: rightRailBottom,
        color: 'rgb(var(--text-primary))',
        textShadow: '0 2px 6px rgba(0,0,0,0.88), 0 10px 28px rgba(0,0,0,0.65)',
      }}
    >
      {(displayHandle || serviceLabel) ? (
        <div className="flex items-center" style={{ gap: 10, lineHeight: 1.1 }}>
          {displayHandle ? (
            pro?.id ? (
              <Link
                href={`/professionals/${encodeURIComponent(pro.id)}`}
                className="pointer-events-auto select-none"
                style={{
                  color: 'white',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: 900,
                  letterSpacing: 0.1,
                  textShadow:
                    '0 2px 6px rgba(0,0,0,0.85), 0 0 10px rgb(var(--micro-accent) / 0.28), 0 0 20px rgb(var(--micro-accent) / 0.14)',
                }}
              >
                <span className="hover:opacity-95">{displayHandle}</span>
              </Link>
            ) : (
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 900,
                  color: 'white',
                  textShadow:
                    '0 2px 6px rgba(0,0,0,0.85), 0 0 10px rgb(var(--micro-accent) / 0.28), 0 0 20px rgb(var(--micro-accent) / 0.14)',
                }}
              >
                {displayHandle}
              </span>
            )
          ) : null}

          {displayHandle && serviceLabel ? <span className="opacity-60">•</span> : null}

          {serviceLabel ? (
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 650,
                color: 'rgba(255,255,255,0.92)',
              }}
            >
              {serviceLabel}
            </span>
          ) : null}
        </div>
      ) : null}

      {m.caption ? (
        <div
          className="mt-1"
          style={{
            fontSize: 13,
            fontWeight: 650,
            lineHeight: 1.25,
            maxWidth: '100%',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as any,
            overflow: 'hidden',
            opacity: 0.95,
            color: 'white',
          }}
        >
          {m.caption}
        </div>
      ) : null}

      {futureSelf ? (
        <div
          className="mt-0.5"
          style={{
            fontSize: 12,
            fontWeight: 650,
            opacity: 0.78,
            color: 'white',
          }}
        >
          {futureSelf}
        </div>
      ) : null}
    </div>
  )
}
