// app/_components/media/MediaFill.tsx

'use client'

import React from 'react'

type MediaType = 'IMAGE' | 'VIDEO'
type Fit = 'cover' | 'contain'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export default function MediaFill(props: {
  src: string
  mediaType: MediaType
  alt?: string
  fit?: Fit
  className?: string
  videoProps?: React.VideoHTMLAttributes<HTMLVideoElement> & Record<string, any>
  imgProps?: React.ImgHTMLAttributes<HTMLImageElement> & Record<string, any>
}) {
  const { src, mediaType, alt, fit = 'cover', className, videoProps, imgProps } = props

  const objectClass = fit === 'contain' ? 'object-contain' : 'object-cover'

  if (mediaType === 'VIDEO') {
    return (
      <video
        src={src}
        playsInline
        preload="metadata"
        className={cx('block h-full w-full', objectClass, className)}
        {...videoProps}
      />
    )
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt || 'Media'}
      draggable={false}
      loading="lazy"
      decoding="async"
      className={cx('block h-full w-full', objectClass, className)}
      {...imgProps}
    />
  )
}