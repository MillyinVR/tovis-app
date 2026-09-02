// app/_components/media/CropWindowFrame.tsx
'use client'

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

import type { CropRect } from '@/lib/media/cropRect'
import type { FocalPoint } from '@/lib/media/focalPoint'
import {
  cropWindowSize,
  fitWindowBox,
  sourceBoxInWindow,
  type Box,
  type Size,
} from '@/lib/media/cropWindow'
import { useElementSize } from '@/lib/ui/useElementSize'
import { cn } from '@/lib/utils'

/**
 * The DOM half of the stored publish crop: two nested boxes that show exactly
 * the window `crop` names, and nothing outside it.
 *
 * `lib/media/cropWindow.ts` owns the arithmetic; this owns the measuring and the
 * markup. It exists as its own component because TWO renderers need it —
 * {@link MediaFill} (the looks feed) and {@link RemoteImage} (every browse grid
 * tile and hero) — and a second hand-rolled copy of a crop layout is a second
 * chance to show the wrong part of somebody's photograph.
 *
 * ── Why it can't be CSS ────────────────────────────────────────────────────
 * `object-fit` fits the WHOLE image and takes no zoom, so it cannot express "show
 * this window". The window is positioned by hand instead: a clipping box the size
 * of the window, with the whole source oversized and back-shifted inside it.
 * Because the source box carries the source's own aspect ratio, the media inside
 * uses `object-fit: fill` and is exact, not a stretch.
 *
 * ── 🔴 Nothing is painted until BOTH sizes are known ───────────────────────
 * Not tidiness: the frame outside the rect is exactly the frame the client did
 * not consent to publishing, so it must never reach a screen — not for one
 * frame, not blurred. `opacity: 0` is the guarantee; the media still mounts and
 * loads, which is how the intrinsic size arrives in the first place.
 *
 * ── 🔴 `focal` must already be in CROP space ───────────────────────────────
 * The stored focal is measured on the UNCROPPED frame. Pass it through
 * `lib/media/cropRect.ts` → `focalInCropSpace` first, or the window centres on
 * somebody's shoulder — with no crash and nothing wrong-looking in a diff.
 */
export type CropWindowFrameChildArgs = {
  /**
   * The class the media element MUST carry. The source box already has the
   * source's own aspect ratio, so any other fit would re-fit an already-fitted
   * box.
   */
  objectFitClass: string
  /**
   * Report the source's intrinsic size (`naturalWidth`/`naturalHeight`, or
   * `videoWidth`/`videoHeight`). Until it fires, the frame paints nothing.
   */
  onNaturalSize: (width: number, height: number) => void
}

export default function CropWindowFrame({
  crop,
  fit,
  focal,
  sourceKey,
  className,
  children,
}: {
  crop: CropRect
  fit: 'cover' | 'contain'
  /** Already remapped into crop space. Only a cover fit can spend it. */
  focal?: FocalPoint | null
  /**
   * Identifies the media the measurement belongs to (its URL). A stale size
   * belongs to the PREVIOUS photo, and laying the previous photo's geometry over
   * this one shows the wrong window of it.
   */
  sourceKey: string
  /**
   * Extra classes for the outer box. It fills its nearest positioned ancestor,
   * matching the `position: absolute; inset: 0` convention every cover-cropping
   * surface in this app already uses for its image.
   */
  className?: string
  children: (args: CropWindowFrameChildArgs) => ReactNode
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const containerSize = useElementSize(containerRef)

  // Keyed by the source it was measured from, and DERIVED rather than reset in
  // an effect, so there is no frame where the two disagree.
  const [measuredSource, setMeasuredSource] = useState<
    { key: string; size: Size } | null
  >(null)

  const onNaturalSize = useCallback(
    (width: number, height: number) => {
      if (!Number.isFinite(width) || !Number.isFinite(height)) return
      if (width <= 0 || height <= 0) return
      setMeasuredSource((previous) =>
        previous &&
        previous.key === sourceKey &&
        previous.size.width === width &&
        previous.size.height === height
          ? previous
          : { key: sourceKey, size: { width, height } },
      )
    },
    [sourceKey],
  )

  const naturalSize =
    measuredSource && measuredSource.key === sourceKey ? measuredSource.size : null

  const measured =
    naturalSize && containerSize
      ? measureCropBoxes({
          crop,
          natural: naturalSize,
          container: containerSize,
          fit,
          focal: fit === 'cover' ? focal : undefined,
        })
      : null

  return (
    <div
      ref={containerRef}
      className={cn('absolute inset-0 overflow-hidden', className)}
    >
      <div
        className="overflow-hidden"
        style={
          measured
            ? boxStyle(measured.windowBox)
            : { position: 'absolute', inset: 0, opacity: 0 }
        }
      >
        <div
          style={
            measured ? boxStyle(measured.sourceBox) : { position: 'absolute', inset: 0 }
          }
        >
          {children({ objectFitClass: 'object-fill', onNaturalSize })}
        </div>
      </div>
    </div>
  )
}

function boxStyle(box: Box): CSSProperties {
  return {
    position: 'absolute',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  }
}

/** The two boxes the crop path lays out, in one place so they cannot drift. */
function measureCropBoxes(args: {
  crop: CropRect
  natural: Size
  container: Size
  fit: 'cover' | 'contain'
  focal?: FocalPoint | null
}): { windowBox: Box; sourceBox: Box } {
  const windowBox = fitWindowBox(
    cropWindowSize(args.crop, args.natural),
    args.container,
    args.fit,
    args.focal,
  )
  return { windowBox, sourceBox: sourceBoxInWindow(args.crop, windowBox) }
}
