// app/(main)/looks/_components/LookMedia.tsx
'use client'

import type { FeedItem } from './lookTypes'
import MediaFill from '@/app/_components/media/MediaFill'

export default function LookMedia({ item, isActive }: { item: FeedItem; isActive: boolean }) {
  const mediaType = item.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE'

  return (
    <MediaFill
      src={item.url}
      mediaType={mediaType}
      alt={item.caption || 'Look'}
      fit="cover"
      videoProps={{
        muted: true,
        loop: true,
        playsInline: true,
        controls: true,
        preload: 'metadata',
        'data-active': isActive ? '1' : '0',
      }}
      imgProps={{
        loading: 'lazy',
        decoding: 'async',
        draggable: false,
      }}
    />
  )
}