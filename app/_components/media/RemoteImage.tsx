// app/_components/media/RemoteImage.tsx
'use client'

import React from 'react'
import Image from 'next/image'

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
    onLoad,
    onError,
  } = props

  const mustRenderRaw =
    intrinsic ||
    isLocalObjectUrl(src) ||
    typeof width !== 'number' ||
    typeof height !== 'number'

  if (mustRenderRaw) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={className}
        style={style}
        width={width}
        height={height}
        draggable={draggable}
        loading={loading ?? 'lazy'}
        decoding="async"
        onLoad={onLoad}
        onError={onError}
      />
    )
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      className={className}
      style={style}
      draggable={draggable}
      loading={loading}
      onLoad={onLoad}
      onError={onError}
      unoptimized
    />
  )
}
