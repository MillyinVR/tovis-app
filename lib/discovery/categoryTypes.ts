// lib/discovery/categoryTypes.ts

export type DiscoverCategoryKind = 'ALL' | 'SERVICE_CATEGORY'

export interface DiscoverCategoryOption {
  kind: DiscoverCategoryKind
  id: string | null
  label: string
  slug: string
}