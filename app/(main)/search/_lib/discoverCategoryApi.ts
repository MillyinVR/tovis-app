// app/(main)/search/_lib/discoverCategoryApi.ts
import type { DiscoverCategoryOption } from '@/lib/discovery/categoryTypes'
import { isArray, isNonEmptyString, isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'

interface DiscoverCategoriesResponse {
  ok: boolean
  categories?: unknown
  error?: unknown
}

function isDiscoverCategoryKind(value: unknown): value is DiscoverCategoryOption['kind'] {
  return value === 'ALL' || value === 'SERVICE_CATEGORY'
}

function isDiscoverCategoryOption(value: unknown): value is DiscoverCategoryOption {
  if (!isRecord(value)) return false

  const { kind, id, label, slug } = value

  return (
    isDiscoverCategoryKind(kind) &&
    (id === null || isNonEmptyString(id)) &&
    isNonEmptyString(label) &&
    isNonEmptyString(slug)
  )
}

function parseDiscoverCategoriesResponse(value: unknown): DiscoverCategoriesResponse {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: 'Invalid discover categories response.',
    }
  }

  return {
    ok: value.ok === true,
    categories: value.categories,
    error: value.error,
  }
}

export async function fetchDiscoverCategories(signal?: AbortSignal): Promise<DiscoverCategoryOption[]> {
  const response = await fetch('/api/discover/categories', {
    cache: 'no-store',
    signal,
  })

  const body = parseDiscoverCategoriesResponse(await safeJson(response))

  if (!response.ok || !body.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Failed to load discover categories.')
  }

  if (!isArray(body.categories)) {
    return []
  }

  return body.categories.filter(isDiscoverCategoryOption)
}