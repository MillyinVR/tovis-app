// app/_components/media/ClickableMedia.tsx
'use client'

import React, { useState } from 'react'
import MediaFill from '@/app/_components/media/MediaFill'
import MediaFullscreenViewer from '@/app/_components/media/MediaFullscreenViewer'
import { cn } from '@/lib/utils'

type MediaType = 'IMAGE' | 'VIDEO'

type Props = {
  /** Thumbnail URL (falls back to `fullSrc`). */
  thumbSrc?: string | null
  /** Full-size URL opened in the viewer (falls back to `thumbSrc`). */
  fullSrc?: string | null
  mediaType: MediaType
  alt?: string
  caption?: string | null

  /** How the thumbnail fills its box. Default `cover`. */
  fit?: 'cover' | 'contain'
  /** Classes for the trigger button — establishes the tile's size/aspect. */
  className?: string
  /** Overlay content rendered on top of the thumbnail (labels, badges). */
  children?: React.ReactNode
  /** Height of a persistent app footer/nav so viewer overlays sit above it. */
  footerOffsetPx?: number
  /** Hide the auto ▶ badge on video thumbnails. */
  hidePlayBadge?: boolean
}

/**
 * A thumbnail that opens the shared full-screen {@link MediaFullscreenViewer}
 * on tap — the single "tap the small media to see it full size" primitive.
 * Works for images and videos (the viewer renders a real `<video controls>`
 * for VIDEO). Callers style the trigger box via `className`; overlays such as
 * BEFORE/AFTER labels go in `children`.
 */
export default function ClickableMedia({
  thumbSrc,
  fullSrc,
  mediaType,
  alt,
  caption,
  fit = 'cover',
  className,
  children,
  footerOffsetPx = 0,
  hidePlayBadge = false,
}: Props) {
  const [open, setOpen] = useState(false)

  const thumb = (thumbSrc ?? '').trim() || (fullSrc ?? '').trim()
  const full = (fullSrc ?? '').trim() || (thumbSrc ?? '').trim()

  // No usable URL → render an inert box so layout is preserved, with any
  // caller-supplied overlay (e.g. a phase label) still visible.
  if (!thumb || !full) {
    return (
      <div className={cn('relative overflow-hidden bg-bgPrimary/20', className)}>
        <div className="grid h-full w-full place-items-center text-[11px] font-black text-textSecondary">
          Unavailable
        </div>
        {children}
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View full size"
        className={cn(
          'group relative block overflow-hidden',
          'focus:outline-none focus:ring-2 focus:ring-accentPrimary/35',
          className,
        )}
      >
        <MediaFill
          src={thumb}
          mediaType={mediaType}
          alt={alt || 'Media'}
          fit={fit}
          className="absolute inset-0 h-full w-full"
          videoProps={{
            muted: true,
            playsInline: true,
            preload: 'metadata',
            controls: false,
          }}
          imgProps={{ loading: 'lazy', decoding: 'async', draggable: false }}
        />

        {mediaType === 'VIDEO' && !hidePlayBadge ? (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-overlay/60 text-textPrimary backdrop-blur-sm">
              ▶
            </span>
          </span>
        ) : null}

        {children}
      </button>

      {open ? (
        <MediaFullscreenViewer
          src={full}
          mediaType={mediaType}
          alt={alt || caption || 'Media'}
          fit="contain"
          showGradients
          footerOffsetPx={footerOffsetPx}
          topLeft={
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={cn(
                'tap-target inline-flex items-center gap-2 rounded-full border border-white/10',
                'bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary',
                'backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.55)]',
                'hover:bg-white/10',
              )}
            >
              ← Back
            </button>
          }
          bottom={
            caption ? (
              <div
                className={cn(
                  'rounded-[18px] border border-white/10 bg-bgPrimary/25 backdrop-blur-xl',
                  'px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.65)]',
                )}
              >
                <div className="text-[14px] font-black leading-snug text-textPrimary">
                  {caption}
                </div>
              </div>
            ) : undefined
          }
        />
      ) : null}
    </>
  )
}
