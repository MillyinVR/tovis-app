// app/(main)/looks/_components/LookMedia.tsx
'use client'

import type { FeedItem } from './lookTypes'
import MediaFill from '@/app/_components/media/MediaFill'

type FeedItemWithRender = FeedItem & {
  renderUrl?: string | null
  renderThumbUrl?: string | null
}

function pickNonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export default function LookMedia({ item, isActive }: { item: FeedItemWithRender; isActive: boolean }) {
  const mediaType = item.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE'

  const renderUrl = pickNonEmpty(item.renderUrl)
  const renderThumbUrl = pickNonEmpty(item.renderThumbUrl)
  const legacyUrl = pickNonEmpty((item as FeedItem).url) // legacy fallback only

  // Images should prefer thumb when available
  const src =
    mediaType === 'VIDEO'
      ? (renderUrl ?? legacyUrl)
      : (renderThumbUrl ?? renderUrl ?? legacyUrl)

  if (!src) {
    return (
      <div className="grid h-full w-full place-items-center bg-bgPrimary/30 text-[12px] font-black text-textSecondary">
        Missing media URL
      </div>
    )
  }

  return (
    <MediaFill
      src={src}
      mediaType={mediaType}
      alt={item.caption || 'Look'}
      fit="cover"
      videoProps={{
        muted: true,
        loop: true,
        playsInline: true,
        // feed UX: don’t show controls unless active
        controls: Boolean(isActive),
        preload: isActive ? 'auto' : 'metadata',
        autoPlay: Boolean(isActive),
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