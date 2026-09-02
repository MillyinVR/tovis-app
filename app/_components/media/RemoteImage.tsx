// app/_components/media/RemoteImage.tsx
'use client'

import React from 'react'
import Image from 'next/image'
import CropWindowFrame from '@/app/_components/media/CropWindowFrame'
import type { CropRect } from '@/lib/media/cropRect'
import { focalObjectPosition, type FocalPoint } from '@/lib/media/focalPoint'
import { cn } from '@/lib/utils'

/**
 * The single place a raw <img> may live.
 *
 * The app serves images from a mix of sources that the Next.js image optimizer
 * cannot (or should not) touch:
 *   - `blob:` / `data:` URLs    — local file previews, generated marks
 *   - short-lived signed URLs    — Supabase `media-private` (`createSignedUrl`)
 *   - arbitrary user-provided    — `avatarUrl` is a free-form string field
 *   - dynamic public-or-signed   — `renderMediaUrls()` picks the bucket per asset
 *
 * So every image is rendered `unoptimized` (matching MediaFill / admin precedent;
 * `next.config` carries no `remotePatterns` by design — Vercel image-optimization
 * cost control). For stable http(s) sources we still go through `next/image`
 * (so the `@next/next/no-img-element` lint rule is satisfied without a disable);
 * `blob:`/`data:`/natural-aspect sources fall back to a plain <img> and the lone
 * eslint-disable in the whole app lives here.
 *
 * Sizing: pass `width`/`height` (the source's intrinsic box; the surrounding
 * `className` still drives the rendered size exactly as the old <img> did). Use
 * `intrinsic` for images shown at their natural aspect ratio (lightboxes, chat
 * attachments) where no fixed box exists.
 */
type RemoteImageProps = {
  src: string
  alt: string
  className?: string
  /** Intrinsic dimensions for next/image. Required unless `intrinsic`. */
  width?: number
  height?: number
  /**
   * Render at the source's natural aspect ratio (height: auto). Forces a raw
   * <img> because next/image needs known dimensions to avoid layout shift.
   */
  intrinsic?: boolean
  sizes?: string
  loading?: 'lazy' | 'eager'
  draggable?: boolean
  style?: React.CSSProperties
  // Normalized subject focal point (camera C6), [0,1] top-left. When the caller
  // renders a cover crop (an `object-cover` className) it becomes the image's
  // `object-position` so the crop centers on the subject. Null/undefined →
  // center (byte-identical to pre-C6).
  focalPoint?: FocalPoint | null
  /**
   * The stored publish crop (`MediaAsset.cropX/Y/W/H` through `resolveCropRect`):
   * the window of the source this surface should display.
   *
   * Null — which is every row in the database today — means the full stored
   * frame and takes the plain path below, byte-identical to before this prop
   * existed. A non-null rect cannot be expressed with `object-fit` (it needs a
   * zoom), so it goes through the shared, measured `CropWindowFrame` instead.
   *
   * 🔴 COVER only. Every caller that passes a rect cover-crops into a fixed
   * aspect box (a 3:4 grid cell, a 4:5 hero), which is the only fit this path
   * implements; a `contain` surface that needs a rect should use `MediaFill`,
   * whose `fit` prop reaches the same frame.
   *
   * 🔴 When a rect is supplied, `focalPoint` must ALREADY be in crop space —
   * `focalInCropSpace(focal, crop)`. The stored focal is measured on the
   * uncropped frame; handing it in raw silently shows the wrong part of the
   * photograph.
   */
  cropRect?: CropRect | null
  /**
   * The source's intrinsic size, once known.
   *
   * 🔴 Why this exists instead of `onLoad`: React's `load` handler does NOT fire
   * for an `<img>` that was ALREADY `complete` when the handler attached — a
   * cached image, or one the browser finished during HTML parse before
   * hydration. That is the NORMAL case on a scrolling grid and on every revisit.
   * This fires from the load event AND from the ref, so a consumer that cannot
   * lay out without the size is never left waiting forever.
   *
   * Measured, not theorised: with the image cached, the crop path below sat at
   * `opacity: 0` and rendered a BLANK tile; with the image delayed 1.2 s it
   * painted correctly. `next/image` handles this internally (which is why
   * `MediaFill` never hit it), the raw `<img>` branch does not.
   */
  onNaturalSize?: (width: number, height: number) => void
  onLoad?: React.ReactEventHandler<HTMLImageElement>
  onError?: React.ReactEventHandler<HTMLImageElement>
}

function isLocalObjectUrl(src: string): boolean {
  return src.startsWith('blob:') || src.startsWith('data:')
}

export default function RemoteImage(props: RemoteImageProps) {
  const {
    src,
    alt,
    className,
    width,
    height,
    intrinsic,
    sizes,
    loading,
    draggable,
    style,
    focalPoint,
    cropRect = null,
    onNaturalSize,
    onLoad,
    onError,
  } = props

  // Merge the focal object-position over any caller style. No focal + no caller
  // style → `mergedStyle` stays undefined → no style attribute (byte-identical).
  const objectPosition = focalObjectPosition(focalPoint)
  const mergedStyle: React.CSSProperties | undefined = objectPosition
    ? { ...style, objectPosition }
    : style

  const mustRenderRaw =
    intrinsic ||
    isLocalObjectUrl(src) ||
    typeof width !== 'number' ||
    typeof height !== 'number'

  /**
   * Report the intrinsic size the moment the element exists and has one — the
   * half of {@link RemoteImageProps.onNaturalSize} that `onLoad` cannot cover.
   * Safe to call repeatedly: consumers dedupe on the value.
   */
  function reportIfComplete(image: HTMLImageElement | null) {
    if (!image || !onNaturalSize) return
    if (image.complete && image.naturalWidth > 0) {
      onNaturalSize(image.naturalWidth, image.naturalHeight)
    }
  }

  function handleImageLoad(event: React.SyntheticEvent<HTMLImageElement, Event>) {
    const image = event.currentTarget
    if (image.naturalWidth > 0) onNaturalSize?.(image.naturalWidth, image.naturalHeight)
    onLoad?.(event)
  }

  function renderImage(
    imageClassName: string | undefined,
    imageStyle: React.CSSProperties | undefined,
  ) {
    if (mustRenderRaw) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={reportIfComplete}
          src={src}
          alt={alt}
          className={imageClassName}
          style={imageStyle}
          width={width}
          height={height}
          draggable={draggable}
          loading={loading ?? 'lazy'}
          decoding="async"
          onLoad={handleImageLoad}
          onError={onError}
        />
      )
    }

    return (
      <Image
        ref={reportIfComplete}
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        className={imageClassName}
        style={imageStyle}
        draggable={draggable}
        loading={loading}
        onLoad={handleImageLoad}
        onError={onError}
        unoptimized
      />
    )
  }

  // ── No stored crop: the plain path ──────────────────────────────────────
  // Every row in the database is here today. Same element, same classes, same
  // style attribute as before `cropRect` existed.
  if (!cropRect) {
    return renderImage(className, mergedStyle)
  }

  // ── A stored crop: the measured path ────────────────────────────────────
  // The caller's className keeps styling the BOX (it is the `absolute inset-0`
  // /`h-full w-full` fill every one of these surfaces already uses, plus any
  // hover/transition treatment), and the image inside fills the source box the
  // frame computes. The focal is consumed as geometry by the frame, so it must
  // NOT also ride along as an `object-position` — hence `style` rather than
  // `mergedStyle` below.
  return (
    <CropWindowFrame
      crop={cropRect}
      fit="cover"
      focal={focalPoint}
      sourceKey={src}
      className={className}
    >
      {({ objectFitClass, onNaturalSize: reportToFrame }) => (
        <RemoteImage
          {...props}
          // The frame owns the box and the geometry; the image just fills the
          // source box it computes. The rect is dropped so this inner render
          // takes the plain path — passing it again would nest a second frame.
          cropRect={null}
          className={cn('h-full w-full', objectFitClass)}
          // 🔴 The focal is spent as GEOMETRY by the frame. Leaving it on would
          // ALSO apply it as `object-position` and move the window twice.
          focalPoint={null}
          onNaturalSize={(w, h) => {
            reportToFrame(w, h)
            onNaturalSize?.(w, h)
          }}
        />
      )}
    </CropWindowFrame>
  )
}
