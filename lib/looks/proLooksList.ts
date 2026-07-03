// lib/looks/proLooksList.ts
//
// Owner-facing listing helpers for GET /api/v1/pro/looks: a pro paging
// through their OWN look posts (drafts included), unlike the public feed
// helpers in lib/looks/feed.ts which only ever serve PUBLISHED + PUBLIC
// rows to viewers. Pro-authored only: client-authored looks (clientAuthorId
// set) never belong to the pro's manageable listing.
import { LookPostStatus, Prisma } from '@prisma/client'

import { isRecord } from '@/lib/guards'
import { ownerScopedLookPostFilter } from '@/lib/tenant'

export const PRO_LOOKS_LISTABLE_STATUSES: readonly LookPostStatus[] = [
  LookPostStatus.DRAFT,
  LookPostStatus.PUBLISHED,
  LookPostStatus.ARCHIVED,
]

/**
 * Parses the optional `status` query param. Absent/blank → every listable
 * status. Unknown values → null so the route can 400 instead of silently
 * returning the default scope.
 */
export function parseProLooksStatusParam(
  value: string | null,
): readonly LookPostStatus[] | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return PRO_LOOKS_LISTABLE_STATUSES
  }

  const match = PRO_LOOKS_LISTABLE_STATUSES.find(
    (status) => status === value.trim().toUpperCase(),
  )

  return match ? [match] : null
}

export function buildProLooksWhere(args: {
  professionalId: string
  statuses: readonly LookPostStatus[]
}): Prisma.LookPostWhereInput {
  return {
    // Owner scoping (stricter than tenant scoping — see
    // ownerScopedLookPostFilter in lib/tenant/visibility.ts).
    ...ownerScopedLookPostFilter(args.professionalId),
    // Pro-facing portfolio queries must exclude client-authored looks (see
    // the LookPost.professionalId comment in prisma/schema.prisma).
    clientAuthorId: null,
    removedAt: null,
    status: { in: [...args.statuses] },
  }
}

export type ProLooksCursor = {
  createdAt: Date
  id: string
}

export function encodeProLooksCursor(row: ProLooksCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: row.createdAt.toISOString(),
      id: row.id,
    }),
    'utf8',
  ).toString('base64url')
}

export function decodeProLooksCursor(
  raw: string | null,
): ProLooksCursor | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null
  if (typeof parsed.id !== 'string' || parsed.id.length === 0) return null
  if (typeof parsed.createdAt !== 'string') return null

  const createdAt = new Date(parsed.createdAt)
  if (Number.isNaN(createdAt.getTime())) return null

  return { createdAt, id: parsed.id }
}

/**
 * Keyset predicate matching the listing order (createdAt desc, id desc).
 */
export function buildProLooksCursorWhere(
  cursor: ProLooksCursor,
): Prisma.LookPostWhereInput {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      {
        createdAt: cursor.createdAt,
        id: { lt: cursor.id },
      },
    ],
  }
}
