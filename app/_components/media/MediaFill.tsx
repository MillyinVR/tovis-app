// app/_components/media/MediaFill.tsx
'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import CropWindowFrame from '@/app/_components/media/CropWindowFrame'
import MediaLoading from '@/app/_components/media/MediaLoading'
import { focalObjectPosition, type FocalPoint } from '@/lib/media/focalPoint'
import type { CropRect } from '@/lib/media/cropRect'
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
  /**
   * Load this image immediately instead of lazily — `next/image` renders it by
   * omitting `loading="lazy"`, so the browser fetches on parse rather than
   * waiting for its lazy-loading heuristic.
   *
   * `imgProps.loading` is deliberately stripped below, so callers have no other
   * way to say "this one first". The looks feed needs it: ten full-screen
   * slides otherwise compete for bandwidth with the one actually on screen,
   * which is why slide 0 took 3.4 s to appear on a good 4G connection.
   *
   * Defaults to false → `next/image`'s own lazy default, byte-identical for
   * every caller that doesn't pass it. Ignored for video.
   */
  priority?: boolean
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
    priority = false,
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
  function renderMedia(
    objectFitClass: string,
    onNaturalSize?: (width: number, height: number) => void,
  ) {
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
            onNaturalSize
              ? (event) => {
                  const video = event.currentTarget
                  onNaturalSize(video.videoWidth, video.videoHeight)
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
        priority={priority}
        {...safeImgProps}
        onLoad={
          onNaturalSize
            ? (event) => {
                const image = event.currentTarget
                onNaturalSize(image.naturalWidth, image.naturalHeight)
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
  // A rect names a WINDOW of the source, and `object-fit` cannot express one, so
  // the window is positioned by hand. All of that arithmetic, the measuring and
  // the consent-safe "paint nothing until both sizes are known" rule live in
  // `CropWindowFrame`, which `RemoteImage` shares — see that file.
  return (
    <CropWindowFrame
      crop={cropRect}
      fit={fit}
      focal={focalPoint}
      sourceKey={mediaUrl}
    >
      {({ objectFitClass, onNaturalSize }) =>
        renderMedia(objectFitClass, onNaturalSize)
      }
    </CropWindowFrame>
  )
}
