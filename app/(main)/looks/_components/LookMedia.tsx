// app/(main)/looks/_components/LookMedia.tsx
'use client'

import type { FeedItem } from './lookTypes'
import MediaFill from '@/app/_components/media/MediaFill'
import BeforeAfterReveal from '@/app/_components/media/BeforeAfterReveal'
import { resolveFocalPoint } from '@/lib/media/focalPoint'

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

  // Before/after pairing → the reveal slider is the money-shot. Only for images
  // (never a video), and it must let vertical swipes fall through to the pager
  // (passVerticalScroll) so it doesn't fight the feed's snap scroll.
  const beforeSrc =
    mediaType === 'IMAGE' && item.before
      ? pickNonEmpty(item.before.thumbUrl) ?? pickNonEmpty(item.before.fullUrl)
      : null

  if (beforeSrc) {
    return (
      <BeforeAfterReveal
        beforeSrc={beforeSrc}
        afterSrc={src}
        beforeAlt={item.caption ? `Before — ${item.caption}` : 'Before'}
        afterAlt={item.caption || 'Look'}
        className="brand-before-after-fill h-full w-full"
        passVerticalScroll
      />
    )
  }

  // Smart 9:16 crop (camera C6): the feed is a full-screen cover crop, so a 3:4
  // capture loses ~40% of its width blind-center. Center the visible window on
  // the subject's focal point. Null → center. (Before/after reveal above stays
  // center in v1 — a dual-image focal is ambiguous.)
  const focalPoint = resolveFocalPoint(item.focalX, item.focalY)

  return (
    <MediaFill
      src={src}
      mediaType={mediaType}
      alt={item.caption || 'Look'}
      fit="cover"
      focalPoint={focalPoint}
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