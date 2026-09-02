// app/(main)/looks/_components/LookMedia.tsx
'use client'

import { useState, type ReactNode } from 'react'
import type { FeedItem } from './lookTypes'
import MediaFill from '@/app/_components/media/MediaFill'
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
    <LetterboxFrame
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
    </LetterboxFrame>
  )
}

/**
 * How far the blurred backdrop is grown past the slide on every edge, in px.
 *
 * A CSS `blur()` samples transparency beyond the element it is applied to, so an
 * image blurred at exactly the slide's size fades out around its own border and
 * leaves a pale vignette inside the visible area. Growing the backdrop past the
 * slide by more than the blur's visible reach (≈3σ, so 72px at σ = 24) puts that
 * fade off-screen by construction rather than by eye.
 */
const BACKDROP_OVERSCAN_PX = 80

/** σ = 24px, dimmed and slightly enriched so the photo in front stays the subject. */
const BACKDROP_FILTER = 'blur(24px) saturate(1.2) brightness(0.62)'

/**
 * The feed's media frame: the look **contained** — the whole published frame,
 * nothing cropped away — over a blurred, cover-cropped copy of itself filling
 * whatever the aspect ratios leave over.
 *
 * This is Tori's ask taken literally ("take the full page like TikTok's For You
 * page, preferably without cropping anything"), and it is what TikTok/Reels
 * themselves do with off-ratio media. Both halves matter:
 *
 *  • **Contain** is what stops the crop. The slide is ~1:2 on a phone and every
 *    row in the database is a 3:4 capture, so the cover crop this replaces was
 *    throwing away a third of the width of every look in the back catalogue —
 *    blind, and usually an arm or the ends of the hair.
 *  • **The blurred self-backdrop** is what keeps it full-page instead of a
 *    photo marooned in two dead bars.
 *
 * As the stored rect gets closer to the slide's own shape the bars shrink to
 * nothing and the backdrop stops being visible at all: a 9:16 frame (what the
 * masked viewfinder will shoot, capture-chain item 1) leaves 44px on a 787px
 * slide. Nothing about this needs to change when that lands.
 */
function LetterboxFrame({
  backdropSrc,
  cropRect,
  focalPoint,
  children,
}: {
  backdropSrc: string | null
  cropRect: CropRect | null
  focalPoint: FocalPoint | null
  children: ReactNode
}) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {backdropSrc ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            left: -BACKDROP_OVERSCAN_PX,
            right: -BACKDROP_OVERSCAN_PX,
            top: -BACKDROP_OVERSCAN_PX,
            bottom: -BACKDROP_OVERSCAN_PX,
          }}
        >
          <MediaFill
            src={backdropSrc}
            mediaType="IMAGE"
            alt=""
            fit="cover"
            // 🔴 The backdrop is cover-cropped, so it must stay inside the
            // published rect too: a blurred figure is still somebody who was
            // framed out. Same rect, same crop-space focal as the photo itself.
            cropRect={cropRect}
            focalPoint={focalPoint}
            showPlaceholder={false}
            imgProps={{
              // The backdrop is decoration behind the photograph and is never
              // given `priority`, so it takes next/image's lazy default and
              // cannot compete with the subject for bandwidth. It is the SAME
              // URL as the foreground image, so on the active slide the browser
              // serves it out of the one request the photo already made.
              decoding: 'async',
              draggable: false,
              'aria-hidden': true,
              style: { filter: BACKDROP_FILTER },
            }}
          />
        </div>
      ) : null}
      {children}
    </div>
  )
}