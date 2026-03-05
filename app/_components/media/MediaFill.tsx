// app/_components/media/MediaFill.tsx
'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

type MediaType = 'IMAGE' | 'VIDEO'
type Fit = 'cover' | 'contain'

function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && (v.startsWith('https://') || v.startsWith('http://'))
}

type Props = {
  // ✅ Preferred: already-renderable http(s) url (public or signed)
  src?: string | null

  // ✅ Optional: if src is missing or not http(s), we can resolve using this
  mediaId?: string | null

  mediaType: MediaType
  alt?: string
  fit?: Fit
  className?: string
  videoProps?: React.VideoHTMLAttributes<HTMLVideoElement> & Record<string, any>
  imgProps?: React.ImgHTMLAttributes<HTMLImageElement> & Record<string, any>

  // Optional UX
  showPlaceholder?: boolean
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

  const initialUrl = useMemo(() => (isHttpUrl(src) ? src : null), [src])
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(initialUrl)
  const [error, setError] = useState<string | null>(null)

  // If caller hands us a valid URL, use it immediately.
  useEffect(() => {
    if (initialUrl) {
      setResolvedUrl(initialUrl)
      setError(null)
      return
    }
    setResolvedUrl(null)
  }, [initialUrl])

  // If src isn't usable, try resolving by mediaId (single source of truth).
  useEffect(() => {
    if (initialUrl) return
    const id = (mediaId || '').trim()
    if (!id) return

    let cancelled = false

    ;(async () => {
      try {
        setError(null)

        const qs = new URLSearchParams({ id })
        const res = await fetch(`/api/media/url?${qs.toString()}`, { method: 'GET', cache: 'no-store' })
        const data = (await res.json().catch(() => null)) as any

        if (cancelled) return
        if (!res.ok) {
          const msg = typeof data?.error === 'string' && data.error.trim() ? data.error.trim() : `Failed (${res.status})`
          setError(msg)
          setResolvedUrl(null)
          return
        }

        const url = data?.url
        if (!isHttpUrl(url)) {
          setError('Resolved URL was not a valid http(s) URL.')
          setResolvedUrl(null)
          return
        }

        setResolvedUrl(url)
      } catch (e) {
        if (cancelled) return
        setError('Failed to load media.')
        setResolvedUrl(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [initialUrl, mediaId])

  if (!resolvedUrl) {
    if (!showPlaceholder) return null

    return (
      <div
        className={cn(
          'grid h-full w-full place-items-center',
          'bg-bgPrimary/20 text-[12px] font-black text-textSecondary',
          className,
        )}
        title={error || 'Missing media'}
      >
        {error ? 'Media unavailable' : 'Loading…'}
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

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={resolvedUrl}
      alt={alt || 'Media'}
      draggable={false}
      loading="lazy"
      decoding="async"
      className={cn('block h-full w-full', objectClass, className)}
      {...imgProps}
    />
  )
}