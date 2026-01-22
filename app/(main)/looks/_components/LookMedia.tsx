// app/(main)/looks/_components/LookMedia.tsx

'use client'

import type { FeedItem } from './lookTypes'

export default function LookMedia({ item, isActive }: { item: FeedItem; isActive: boolean }) {
  if (item.mediaType === 'IMAGE') {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={item.url}
        alt={item.caption || 'Look'}
        draggable={false}
        className="block h-full w-full object-cover"
        loading="lazy"
        decoding="async"
      />
    )
  }

  return (
    <video
      src={item.url}
      muted
      loop
      playsInline
      controls
      preload="metadata"
      className="block h-full w-full object-cover"
      data-active={isActive ? '1' : '0'}
    />
  )
}
