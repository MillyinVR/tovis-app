// app/(main)/looks/_components/LookMedia.tsx
'use client'

import { useState, type ReactNode } from 'react'
import type { FeedItem } from './lookTypes'
import MediaFill from '@/app/_components/media/MediaFill'
import FeedLetterboxFrame from '@/app/_components/media/FeedLetterboxFrame'
import BeforeAfterReveal from '@/app/_components/media/BeforeAfterReveal'
import type { FocalPoint } from '@/lib/media/focalPoint'
import { resolveDisplayCrop, type CropRect } from '@/lib/media/cropRect'

/**
 * How eagerly this slide's media should be fetched, by distance from the one
 * being looked at. `LooksFeed` assigns it; see `slidePreload`.
 */
export type SlidePreload = 'eager' | 'lazy' | 'defer'

function pickNonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export default function LookMedia({
  item,
  isActive,
  preload = 'eager',
}: {
  item: FeedItem
  isActive: boolean
  preload?: SlidePreload
}) {
  // Safety net for the derived thumbnail. `thumbUrl` is now usually a Supabase
  // *render-endpoint* URL rather than a stored file, and Supabase documents
  // image transformations as a Pro-plan feature while this project is on Free.
  // It works today — the response carries
  // `x-transformations: width:1080,resizing_type:fit,quality:70` — but if that
  // ever stops being served, EVERY photograph in the feed would break at once.
  // Falling back to the stored original turns a blank feed into a slow one,
  // which is exactly where we were before this change.
  //
  // No reset needed: LookSlide keys on `item.id`, so a different look is a
  // different component instance. Re-failing on the original sets the same
  // value, so there is no loop.
  const [thumbFailed, setThumbFailed] = useState(false)

  const mediaType = item.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE'

  // 🔴 `thumbUrl` is the DOWNSCALED render (lib/media/imageTransform), and `url`
  // is the stored original — for a phone capture, 3024×4032 and ~4.5 MB for a
  // 393pt-wide slide. Prefer the thumb for an image.
  //
  // This used to read `item.renderThumbUrl`/`item.renderUrl`, which
  // `LooksFeedItemDto` has never carried — the server maps its rendered URLs
  // onto `url`/`thumbUrl` before they go over the wire. Both were always
  // `undefined`, so every slide silently fell through to the original.
  const fullUrl = pickNonEmpty(item.url)
  const thumbUrl = pickNonEmpty(item.thumbUrl)

  const usableThumb = thumbFailed ? null : thumbUrl
  const src = mediaType === 'VIDEO' ? fullUrl : (usableThumb ?? fullUrl)

  // Far from the active slide: keep the slide itself (its height is the
  // scroller's, set by LookSlide, and the media is absolutely positioned inside
  // it — so nothing here can move the snap geometry) but do not fetch anything.
  // Ten full-screen photographs competing with the one on screen is what made
  // slide 0 take 3.4 s.
  if (preload === 'defer') {
    return <div className="absolute inset-0 bg-bgPrimary" aria-hidden="true" />
  }

  const eager = preload === 'eager'

  if (!src) {
    return (
      <div className="grid h-full w-full place-items-center bg-bgPrimary/30 text-[12px] font-black text-textSecondary">
        Missing media URL
      </div>
    )
  }

  // Before/after pairing → the reveal slider is the money-shot. Only for images
  // (never a video), and it must let vertical swipes fall through to the pager
  // (passVerticalScroll) so it doesn't fight the feed's snap scroll.
  const beforeSrc =
    mediaType === 'IMAGE' && item.before
      ? pickNonEmpty(item.before.thumbUrl) ?? pickNonEmpty(item.before.fullUrl)
      : null

  if (beforeSrc) {
    return (
      <BeforeAfterReveal
        beforeSrc={beforeSrc}
        afterSrc={src}
        beforeAlt={item.caption ? `Before — ${item.caption}` : 'Before'}
        afterAlt={item.caption || 'Look'}
        className="brand-before-after-fill h-full w-full"
        passVerticalScroll
      />
    )
  }

  // The pro's published frame — the window of the stored image this look is
  // meant to be seen through (capture-chain item 2), with the focal already
  // remapped into that window's own space. Same helper every honouring surface
  // uses, including the VIDEO exclusion; see `resolveDisplayCrop`.
  const { cropRect, focalPoint } = resolveDisplayCrop({ ...item, mediaType })

  // For a video the backdrop is the poster, never a second decoding <video>:
  // one moving picture per slide, and a blurred still behind it reads the same.
  const backdropSrc = mediaType === 'VIDEO' ? usableThumb : src

  return (
    <FeedLetterboxFrame
      backdropSrc={backdropSrc}
      cropRect={cropRect}
      focalPoint={focalPoint}
    >
      <MediaFill
        src={src}
        mediaType={mediaType}
        alt={item.caption || 'Look'}
        fit="contain"
        cropRect={cropRect}
        // The slide you are looking at, and its two neighbours, jump the queue.
        priority={eager}
        videoProps={{
          muted: true,
          loop: true,
          playsInline: true,
          // feed UX: don’t show controls unless active
          controls: Boolean(isActive),
          preload: isActive ? 'auto' : 'metadata',
          autoPlay: Boolean(isActive),
          'data-active': isActive ? '1' : '0',
        }}
        imgProps={{
          // ⚠️ No `loading` here: MediaFill strips it from imgProps, because
          // next/image owns that decision. `priority` above is the only lever —
          // true omits loading="lazy" so the browser fetches immediately, false
          // leaves next/image's lazy default, which is what a slide you are not
          // looking at should get.
          decoding: 'async',
          draggable: false,
          onError: () => setThumbFailed(true),
        }}
      />
    </FeedLetterboxFrame>
  )
}
