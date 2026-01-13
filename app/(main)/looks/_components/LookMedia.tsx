// app/(main)/looks/_components/LookMedia.tsx

'use client'

type FeedItem = {
  id: string
  url: string
  mediaType: 'IMAGE' | 'VIDEO'
  caption: string | null
}

export default function LookMedia({ item, isActive }: { item: FeedItem; isActive: boolean }) {
  // later: if VIDEO, we can autoplay only when isActive === true
  if (item.mediaType === 'IMAGE') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.url} alt={item.caption || 'Look'} draggable={false} className="block h-full w-full object-cover" />
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
      // later: use isActive to play/pause programmatically
      data-active={isActive ? '1' : '0'}
    />
  )
}
