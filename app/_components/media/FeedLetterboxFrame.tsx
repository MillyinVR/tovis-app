// app/_components/media/FeedLetterboxFrame.tsx
//
// The feed's media frame, extracted so it has exactly ONE implementation.
//
// 🔴 Why it lives here rather than beside the feed. The crop editor previews what
// a look will look like as a slide, and a preview that re-implements the slide is
// a preview that drifts from it — the pro would be framing against a lie. Same
// reasoning #1062 applied when it gave every surface one shared renderer instead
// of one per grid. The feed (`LookMedia`) and the editor's preview
// (`CropFeedPreview`) both render THIS.
//
// Moved VERBATIM out of `LookMedia.tsx` — the feed's render is unchanged.
'use client'

import type { ReactNode } from 'react'

import MediaFill from '@/app/_components/media/MediaFill'
import type { CropRect } from '@/lib/media/cropRect'
import type { FocalPoint } from '@/lib/media/focalPoint'

/**
 * How far the blurred backdrop is grown past the slide on every edge, in px.
 *
 * A CSS `blur()` samples transparency beyond the element it is applied to, so an
 * image blurred at exactly the slide's size fades out around its own border and
 * leaves a pale vignette inside the visible area. Growing the backdrop past the
 * slide by more than the blur's visible reach (≈3σ, so 72px at σ = 24) puts that
 * fade off-screen by construction rather than by eye.
 */
export const BACKDROP_OVERSCAN_PX = 80

/** σ = 24px, dimmed and slightly enriched so the photo in front stays the subject. */
export const BACKDROP_FILTER = 'blur(24px) saturate(1.2) brightness(0.62)'

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
export default function FeedLetterboxFrame({
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