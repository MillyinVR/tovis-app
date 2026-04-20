// app/(main)/looks/_components/lookTypes.ts

import type {
  LooksCommentDto,
  LooksFeedItemDto,
} from '@/lib/looks/types'

export type FeedItem = LooksFeedItemDto

export type UiComment = LooksCommentDto

export type UiCategory = {
  name: string
  slug: string
}