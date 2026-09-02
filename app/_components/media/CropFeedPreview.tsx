// app/_components/media/CropFeedPreview.tsx
//
// What this crop will look like as a Looks slide, live, while the pro drags it.
//
// 🔴 It renders the FEED'S OWN frame (`FeedLetterboxFrame`), not a copy of it.
// A preview that re-implements the slide is a preview that drifts from it, and a
// pro framing against a drifted preview is worse off than one framing against
// nothing. If the feed's treatment changes, this changes with it or not at all.
//
// ── What the pro is actually choosing ────────────────────────────────────────
//
// Since item 3 the feed CONTAINS its media, so the rect is shown whole — nothing
// beyond the crop is ever cut. What the shape decides is how much of the phone
// the look commands versus blurred band:
//
//   9:16  → fills almost the whole slide
//   4:5   → noticeable bands top and bottom
//   1:1   → about half the slide is backdrop
//
// That is invisible in the crop frame itself (which takes the PHOTO's shape), so
// without this panel the pro picks a shape and finds out later.
//
// ── Why 9:19.5 ──────────────────────────────────────────────────────────────
//
// A real slide is `100dvh` minus the footer on web and full-bleed on iOS, so its
// exact ratio depends on the device. This previews the TALLEST common phone,
// which is the worst case for banding — so what the pro sees here is never
// rosier than what they will get. Erring the other way would flatter the crop.
'use client'

import FeedLetterboxFrame from '@/app/_components/media/FeedLetterboxFrame'
import MediaFill from '@/app/_components/media/MediaFill'
import type { CropRect } from '@/lib/media/cropRect'
import type { FocalPoint } from '@/lib/media/focalPoint'

/** The tallest common phone slide — see the header for why this and not an average. */
const PREVIEW_ASPECT = 9 / 19.5

export default function CropFeedPreview({
  src,
  cropRect,
  focalPoint,
}: {
  src: string
  /** The rect being dragged right now, not the stored one. */
  cropRect: CropRect | null
  /** Already remapped into crop space by the caller, as every cover fit expects. */
  focalPoint: FocalPoint | null
}) {
  return (
    <figure className="grid gap-1.5">
      <div
        data-testid="crop-feed-preview"
        className="relative overflow-hidden rounded-[14px] bg-bgPrimary"
        style={{ aspectRatio: `${PREVIEW_ASPECT}` }}
      >
        <FeedLetterboxFrame
          backdropSrc={src}
          cropRect={cropRect}
          focalPoint={focalPoint}
        >
          <MediaFill
            src={src}
            mediaType="IMAGE"
            alt=""
            fit="contain"
            cropRect={cropRect}
            focalPoint={focalPoint}
            showPlaceholder={false}
            imgProps={{ draggable: false, 'aria-hidden': true }}
          />
        </FeedLetterboxFrame>
      </div>

      <figcaption className="text-[11px] leading-snug text-textSecondary">
        In the feed
      </figcaption>
    </figure>
  )
}
