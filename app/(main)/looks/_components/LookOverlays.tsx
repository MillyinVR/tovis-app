// app/(main)/looks/_components/LookOverlays.tsx
'use client'

import Link from 'next/link'
import type { FeedItem } from './lookTypes'

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
      className="absolute z-2"
      style={{
        left: 12,
        right: 92,
        bottom: rightRailBottom,
        textShadow: '0 2px 6px rgba(0,0,0,0.88), 0 10px 28px rgba(0,0,0,0.65)',
      }}
    >
      {(displayHandle || serviceLabel) ? (
        <div className="flex items-center gap-2.5 leading-tight">
          {displayHandle ? (
            pro?.id ? (
              <Link
                href={`/professionals/${encodeURIComponent(pro.id)}`}
                className="pointer-events-auto select-none text-white no-underline"
              >
                <span
                  className="text-[14px] font-black hover:opacity-95"
                  style={{
                    textShadow:
                      '0 2px 6px rgba(0,0,0,0.85), 0 0 10px rgb(var(--micro-accent) / 0.28), 0 0 20px rgb(var(--micro-accent) / 0.14)',
                  }}
                >
                  {displayHandle}
                </span>
              </Link>
            ) : (
              <span
                className="text-[14px] font-black text-white"
                style={{
                  textShadow:
                    '0 2px 6px rgba(0,0,0,0.85), 0 0 10px rgb(var(--micro-accent) / 0.28), 0 0 20px rgb(var(--micro-accent) / 0.14)',
                }}
              >
                {displayHandle}
              </span>
            )
          ) : null}

          {displayHandle && serviceLabel ? <span className="opacity-60 text-white">•</span> : null}

          {serviceLabel ? <span className="text-[12.5px] font-semibold text-white/90">{serviceLabel}</span> : null}
        </div>
      ) : null}

      {m.caption ? (
        <div
          className="mt-1 text-white"
          style={{
            fontSize: 13,
            fontWeight: 650,
            lineHeight: 1.25,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as any,
            overflow: 'hidden',
            opacity: 0.95,
          }}
        >
          {m.caption}
        </div>
      ) : null}

      {futureSelf ? (
        <div className="mt-0.5 text-[12px] font-semibold text-white/80">{futureSelf}</div>
      ) : null}
    </div>
  )
}
