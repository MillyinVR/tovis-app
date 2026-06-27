// app/_components/media/MediaFill.tsx
'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import MediaLoading from '@/app/_components/media/MediaLoading'
import { cn } from '@/lib/utils'

type MediaType = 'IMAGE' | 'VIDEO'
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
  } = props

  const objectClass = fit === 'contain' ? 'object-contain' : 'object-cover'
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

  if (mediaType === 'VIDEO') {
    return (
      <video
        src={resolvedUrl}
        playsInline
        preload="metadata"
        className={cn('block h-full w-full', objectClass, className)}
        {...videoProps}
      />
    )
  }

   const {
    src: _ignoredImgSrc,
    alt: _ignoredImgAlt,
    className: _ignoredImgClassName,
    width: _ignoredImgWidth,
    height: _ignoredImgHeight,
    sizes: _ignoredImgSizes,
    loading: _ignoredImgLoading,
    decoding: _ignoredImgDecoding,
    ...safeImgProps
  } = imgProps ?? {}

  return (
    <Image
      src={resolvedUrl}
      alt={alt ?? 'Media'}
      fill
      sizes="100vw"
      draggable={false}
      className={cn(objectClass, className)}
      unoptimized
      {...safeImgProps}
    />
  )
}