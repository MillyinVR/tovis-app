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

  // ---- Optional fields (Spotlight + future-proofing) ----

  // Returned by /api/looks already (useful for distinguishing pro vs client uploads)
  uploadedByRole?: 'CLIENT' | 'PRO' | null

  // If present, this media came from a review (Spotlight candidate)
  reviewId?: string | null

  // Review metadata for “Review Spotlight” UI (only populated when API includes it)
  reviewHelpfulCount?: number | null
  reviewRating?: number | null
  reviewHeadline?: string | null
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