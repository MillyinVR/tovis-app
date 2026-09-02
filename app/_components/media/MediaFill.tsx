// app/_components/media/MediaFill.tsx
'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import MediaLoading from '@/app/_components/media/MediaLoading'
import { focalObjectPosition, type FocalPoint } from '@/lib/media/focalPoint'
import type { CropRect } from '@/lib/media/cropRect'
import {
  cropWindowSize,
  fitWindowBox,
  sourceBoxInWindow,
  type Box,
  type Size,
} from '@/lib/media/cropWindow'
import { useElementSize } from '@/lib/ui/useElementSize'
import { cn } from '@/lib/utils'
import type { MediaType } from '@prisma/client'

type Fit = 'cover' | 'contain'

type MediaUrlResponse = {
  url?: unknown
  error?: unknown
}

type Props = {
  src?: string | null
  mediaId?: string | null
  mediaType: MediaType
  alt?: string
  fit?: Fit
  className?: string
  videoProps?: React.VideoHTMLAttributes<HTMLVideoElement> & Record<string, unknown>
  imgProps?: React.ImgHTMLAttributes<HTMLImageElement> & Record<string, unknown>
  showPlaceholder?: boolean
  // Normalized subject focal point (camera C6), [0,1] top-left. With fit="cover"
  // it becomes the image's `object-position` so the visible window centers on
  // the subject instead of the geometric center. Null/undefined → center (the
  // pre-C6 default), so it's byte-identical when no focal is supplied.
  //
  // 🔴 When `cropRect` is also supplied this must ALREADY be in crop space —
  // `focalInCropSpace(focal, crop)`. The stored focal is measured on the
  // uncropped frame; handing it in raw silently posts the wrong part of the
  // photograph. `LookMedia` is the reference caller.
  focalPoint?: FocalPoint | null
  // The stored publish crop (MediaAsset.cropX/Y/W/H, resolved through
  // `resolveCropRect`): the window of the source this surface should display.
  //
  // Null — which is every row in the database today — means the full stored
  // frame and takes the plain CSS `object-fit` path below, byte-identical to
  // before this prop existed. A non-null rect can't be expressed with
  // `object-fit` (it needs a zoom), so it takes a measured path instead; see
  // `lib/media/cropWindow.ts` and docs/design/media-crop-rect.md.
  cropRect?: CropRect | null
}

function boxStyle(box: Box): React.CSSProperties {
  return {
    position: 'absolute',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  }
}

function isHttpUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value.startsWith('https://') || value.startsWith('http://'))
  )
}

function readApiError(data: MediaUrlResponse | null, fallback: string): string {
  const rawError = data?.error

  if (typeof rawError === 'string' && rawError.trim()) {
    return rawError.trim()
  }

  return fallback
}

export default function MediaFill(props: Props) {
  const {
    src,
    mediaId,
    mediaType,
    alt,
    fit = 'cover',
    className,
    videoProps,
    imgProps,
    showPlaceholder = true,
    focalPoint,
    cropRect = null,
  } = props

  const objectClass = fit === 'contain' ? 'object-contain' : 'object-cover'
  // Only a cover crop has spare pixels to shift; a contain fit shows the whole
  // frame, so a focal point is a no-op there.
  const objectPosition =
    !cropRect && fit === 'cover' ? focalObjectPosition(focalPoint) : undefined
  const directUrl = useMemo(() => (isHttpUrl(src) ? src : null), [src])

  const [resolvedMediaId, setResolvedMediaId] = useState<string | null>(null)
  const [resolvedMediaUrl, setResolvedMediaUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Crop path only — the container it has to fit the window into, and the
  // source's intrinsic size. Both null until measured; the hooks run
  // unconditionally (rules of hooks) and cost nothing on the null-crop path,
  // where the ref is never attached and the media never reports a size.
  const cropContainerRef = useRef<HTMLDivElement | null>(null)
  const cropContainerSize = useElementSize(cropContainerRef)
  // Keyed by the URL it was measured from: a stale size belongs to the previous
  // photo, and laying the previous photo's geometry over this one would show the
  // wrong window of it. Derived rather than reset in an effect, so there is no
  // frame where the two disagree.
  const [measuredSource, setMeasuredSource] = useState<
    { url: string; size: Size } | null
  >(null)

  useEffect(() => {
    if (directUrl) return

    const id = (mediaId ?? '').trim()
    if (!id) return

    let cancelled = false

    async function resolveMediaUrl(): Promise<void> {
      try {
        const qs = new URLSearchParams({ id })
        const res = await fetch(`/api/v1/media/url?${qs.toString()}`, {
          method: 'GET',
          cache: 'no-store',
        })

        const data = (await res.json().catch(() => null)) as MediaUrlResponse | null

        if (cancelled) return

        if (!res.ok) {
          setError(readApiError(data, `Failed (${res.status})`))
          setResolvedMediaId(id)
          setResolvedMediaUrl(null)
          return
        }

        const url = data?.url
        if (!isHttpUrl(url)) {
          setError('Resolved URL was not a valid http(s) URL.')
          setResolvedMediaId(id)
          setResolvedMediaUrl(null)
          return
        }

        setError(null)
        setResolvedMediaId(id)
        setResolvedMediaUrl(url)
      } catch {
        if (cancelled) return

        setError('Failed to load media.')
        setResolvedMediaId(id)
        setResolvedMediaUrl(null)
      }
    }

    void resolveMediaUrl()

    return () => {
      cancelled = true
    }
  }, [directUrl, mediaId])

  const requestedMediaId = (mediaId ?? '').trim()
  const resolvedUrl =
    directUrl ??
    (requestedMediaId && resolvedMediaId === requestedMediaId
      ? resolvedMediaUrl
      : null)

  const isLoading = Boolean(!directUrl && requestedMediaId && resolvedMediaId !== requestedMediaId)

  const naturalSize =
    measuredSource && measuredSource.url === resolvedUrl ? measuredSource.size : null

  const applyNaturalSize = useCallback(
    (url: string, width: number, height: number) => {
      if (!Number.isFinite(width) || !Number.isFinite(height)) return
      if (width <= 0 || height <= 0) return
      setMeasuredSource((previous) =>
        previous &&
        previous.url === url &&
        previous.size.width === width &&
        previous.size.height === height
          ? previous
          : { url, size: { width, height } },
      )
    },
    [],
  )

  if (!resolvedUrl) {
    if (!showPlaceholder) return null

    if (isLoading) {
      return <MediaLoading className={className} />
    }

    return (
      <div
        className={cn(
          'grid h-full w-full place-items-center',
          'bg-bgPrimary/20 text-[12px] font-black text-textSecondary',
          className,
        )}
        title={error ?? 'Missing media'}
      >
        {error ? 'Media unavailable' : 'Missing media'}
      </div>
    )
  }

  // Bound after the guard above so its type is `string`, not `string | null`:
  // `renderMedia` is hoisted, so a narrowing of `resolvedUrl` would not reach
  // inside it.
  const mediaUrl = resolvedUrl

  const {
    src: _ignoredImgSrc,
    alt: _ignoredImgAlt,
    className: _ignoredImgClassName,
    width: _ignoredImgWidth,
    height: _ignoredImgHeight,
    sizes: _ignoredImgSizes,
    loading: _ignoredImgLoading,
    decoding: _ignoredImgDecoding,
    style: imgStyle,
    ...safeImgProps
  } = imgProps ?? {}

  // Merge the focal object-position over any caller style. When there's no focal
  // AND no caller style, `mergedStyle` stays undefined → no style attribute →
  // byte-identical to pre-C6.
  const mergedStyle: React.CSSProperties | undefined = objectPosition
    ? { ...imgStyle, objectPosition }
    : imgStyle

  /**
   * The media element itself. `objectFitClass` differs between the two paths:
   * the plain path hands CSS the whole job (`object-cover` / `object-contain`),
   * while the crop path has already sized the box to the source's own aspect
   * ratio, so the media must simply `fill` it.
   */
  function renderMedia(objectFitClass: string) {
    if (mediaType === 'VIDEO') {
      return (
        <video
          src={mediaUrl}
          playsInline
          preload="metadata"
          className={cn('block h-full w-full', objectFitClass, className)}
          {...videoProps}
          // After the caller's props on purpose: the crop path cannot lay out
          // without the intrinsic size, so this handler must not be overridable.
          // It forwards to the caller's own handler rather than replacing it.
          onLoadedMetadata={
            cropRect
              ? (event) => {
                  const video = event.currentTarget
                  applyNaturalSize(mediaUrl, video.videoWidth, video.videoHeight)
                  videoProps?.onLoadedMetadata?.(event)
                }
              : videoProps?.onLoadedMetadata
          }
        />
      )
    }

    return (
      <Image
        src={mediaUrl}
        alt={alt ?? 'Media'}
        fill
        sizes="100vw"
        draggable={false}
        className={cn(objectFitClass, className)}
        style={mergedStyle}
        unoptimized
        {...safeImgProps}
        onLoad={
          cropRect
            ? (event) => {
                const image = event.currentTarget
                applyNaturalSize(mediaUrl, image.naturalWidth, image.naturalHeight)
                safeImgProps.onLoad?.(event)
              }
            : safeImgProps.onLoad
        }
      />
    )
  }

  // ── No stored crop: the plain CSS path ──────────────────────────────────
  // Every row in the database is here today. Same element, same classes, same
  // style attribute as before this prop existed — no wrapper, no measurement,
  // no extra render. Pinned by MediaFill.test.tsx.
  if (!cropRect) {
    return renderMedia(objectClass)
  }

  // ── A stored crop: the measured path ────────────────────────────────────
  // A rect names a WINDOW of the source, and `object-fit` cannot express one —
  // it fits the whole image and takes no zoom. So the window is positioned by
  // hand: a clipping box the size of the window, with the whole source
  // oversized and back-shifted inside it (lib/media/cropWindow.ts). Because the
  // source box carries the source's own aspect ratio, `object-fill` into it is
  // exact, not a stretch.
  //
  // 🔴 Nothing is painted until BOTH the container and the source's intrinsic
  // size are known. That is not tidiness: the frame outside the rect is exactly
  // the frame the client did not consent to publishing, so it must never reach
  // a screen — not even for one frame, not even blurred. `opacity: 0` is the
  // guarantee; the media still mounts and loads, which is how the intrinsic
  // size arrives in the first place.
  const measured =
    naturalSize && cropContainerSize
      ? measureCropBoxes({
          crop: cropRect,
          natural: naturalSize,
          container: cropContainerSize,
          fit,
          focal: fit === 'cover' ? focalPoint : undefined,
        })
      : null

  return (
    <div ref={cropContainerRef} className="absolute inset-0 overflow-hidden">
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
            measured
              ? boxStyle(measured.sourceBox)
              : { position: 'absolute', inset: 0 }
          }
        >
          {renderMedia('object-fill')}
        </div>
      </div>
    </div>
  )
}

/** The two boxes the crop path lays out, in one place so they cannot drift. */
function measureCropBoxes(args: {
  crop: CropRect
  natural: Size
  container: Size
  fit: Fit
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
