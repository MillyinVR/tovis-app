// app/(main)/looks/_components/LookMedia.tsx
'use client'

import type { ReactNode } from 'react'
import type { FeedItem } from './lookTypes'
import MediaFill from '@/app/_components/media/MediaFill'
import BeforeAfterReveal from '@/app/_components/media/BeforeAfterReveal'
import { resolveFocalPoint, type FocalPoint } from '@/lib/media/focalPoint'
import { focalInCropSpace, resolveCropRect, type CropRect } from '@/lib/media/cropRect'

type FeedItemWithRender = FeedItem & {
  renderUrl?: string | null
  renderThumbUrl?: string | null
}

function pickNonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export default function LookMedia({ item, isActive }: { item: FeedItemWithRender; isActive: boolean }) {
  const mediaType = item.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE'

  const renderUrl = pickNonEmpty(item.renderUrl)
  const renderThumbUrl = pickNonEmpty(item.renderThumbUrl)
  const legacyUrl = pickNonEmpty((item as FeedItem).url) // legacy fallback only

  // Images should prefer thumb when available
  const src =
    mediaType === 'VIDEO'
      ? (renderUrl ?? legacyUrl)
      : (renderThumbUrl ?? renderUrl ?? legacyUrl)

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
  // meant to be seen through (capture-chain item 2). Null on every row written
  // so far, which means the full stored frame.
  const cropRect = resolveCropRect(item.cropX, item.cropY, item.cropW, item.cropH)

  // 🔴 The focal is measured on the UNCROPPED frame, so it has to be re-expressed
  // inside the crop before any cover fit uses it — otherwise the blurred
  // backdrop below anchors on the wrong part of the photograph. `null` crop →
  // crop space IS frame space and this returns the focal unchanged.
  const focalPoint = focalInCropSpace(
    resolveFocalPoint(item.focalX, item.focalY),
    cropRect,
  )

  // For a video the backdrop is the poster, never a second decoding <video>:
  // one moving picture per slide, and a blurred still behind it reads the same.
  const backdropSrc = mediaType === 'VIDEO' ? (renderThumbUrl ?? pickNonEmpty(item.thumbUrl)) : src

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
          loading: 'lazy',
          decoding: 'async',
          draggable: false,
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
              loading: 'lazy',
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