// app/_components/media/MediaFullscreenViewer.tsx
'use client'

import React, { useEffect } from 'react'
import { cn } from '@/lib/utils'

type MediaType = 'IMAGE' | 'VIDEO'

type Props = {
  src: string
  mediaType: MediaType
  alt?: string
  fit?: 'contain' | 'cover'

  topLeft?: React.ReactNode
  topRight?: React.ReactNode
  bottom?: React.ReactNode
  center?: React.ReactNode

  showGradients?: boolean
  className?: string

  /**
   * Height of your persistent app footer/nav (px).
   * Bottom overlays will sit ABOVE it.
   */
  footerOffsetPx?: number
}

export default function MediaFullscreenViewer({
  src,
  mediaType,
  alt,
  fit = 'contain',
  topLeft,
  topRight,
  bottom,
  center,
  showGradients = true,
  className,
  footerOffsetPx = 0,
}: Props) {
  const objectClass = fit === 'cover' ? 'object-cover' : 'object-contain'
  const safeSrc = (src || '').trim()

  // ✅ Stop the page behind it from scrolling (especially iOS)
  useEffect(() => {
    const body = document.body
    const html = document.documentElement

    const prevBodyOverflow = body.style.overflow
    const prevBodyPosition = body.style.position
    const prevBodyWidth = body.style.width
    const prevHtmlOverflow = html.style.overflow

    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'

    // iOS Safari: prevent rubber-band scroll
    body.style.position = 'fixed'
    body.style.width = '100%'

    return () => {
      body.style.overflow = prevBodyOverflow
      body.style.position = prevBodyPosition
      body.style.width = prevBodyWidth
      html.style.overflow = prevHtmlOverflow
    }
  }, [])

  // ✅ Guard: never render broken media elements
  if (!safeSrc) {
    return (
      <main className={cn('fixed inset-0 z-[9990] grid place-items-center bg-black', className || '')}>
        <div className="rounded-card border border-white/10 bg-bgPrimary/40 px-4 py-3 text-sm font-semibold text-textSecondary">
          Missing media URL.
        </div>
      </main>
    )
  }

  return (
    <main className={cn('fixed inset-0 z-[9990] overflow-hidden bg-black', className || '')}>
      {/* MEDIA LAYER */}
      <div className="absolute inset-0">
        {mediaType === 'VIDEO' ? (
          <video src={safeSrc} controls playsInline preload="metadata" className={cn('h-full w-full', objectClass)} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={safeSrc}
            alt={alt || 'Media'}
            draggable={false}
            loading="eager"
            decoding="async"
            className={cn('h-full w-full', objectClass)}
          />
        )}
      </div>

      {/* READABILITY GRADIENTS */}
      {showGradients ? (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/80 to-transparent" />
        </div>
      ) : null}

      {/* OVERLAY LAYER */}
      <div className="absolute inset-0">
        {/* Top bar */}
        {topLeft || topRight ? (
          <div
            className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-4"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          >
            <div className="pointer-events-auto">{topLeft}</div>
            <div className="pointer-events-auto">{topRight}</div>
          </div>
        ) : null}

        {/* Center floating UI */}
        {center ? <div className="pointer-events-auto absolute inset-0 z-20">{center}</div> : null}

        {/* Bottom overlay: anchor ABOVE the app footer */}
        {bottom ? (
          <div
            className="absolute inset-x-0 z-20 px-4"
            style={{
              bottom: footerOffsetPx,
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
            }}
          >
            <div className="pointer-events-auto mx-auto w-full max-w-[680px]">{bottom}</div>
          </div>
        ) : null}
      </div>
    </main>
  )
}