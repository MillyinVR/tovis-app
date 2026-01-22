// app/(main)/looks/_components/lookTypes.ts

export type FeedItem = {
  id: string
  url: string
  thumbUrl?: string | null
  mediaType: 'IMAGE' | 'VIDEO'
  caption: string | null
  professional: {
    id: string
    businessName: string | null
    handle?: string | null
    professionType?: string | null
    avatarUrl?: string | null
    location?: string | null
  } | null
  _count: { likes: number; comments: number }
  viewerLiked: boolean
  serviceId?: string | null
  serviceName?: string | null
  category?: string | null
}

export type UiComment = {
  id: string
  body: string
  createdAt: string
  user: { id: string; displayName: string; avatarUrl: string | null }
}

export type UiCategory = {
  name: string
  slug: string
}
