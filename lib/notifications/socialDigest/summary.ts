// lib/notifications/socialDigest/summary.ts
//
// PURE shaping of a recipient's unread social notifications into the digest
// summary (grouped counts + a short recent-activity list). No I/O, no dates
// beyond comparison — unit-tested directly.
import { NotificationEventKey } from '@prisma/client'

import {
  MAX_DIGEST_RECENT_ITEMS,
  SOCIAL_DIGEST_GROUPS,
  type SocialDigestGroupDef,
  type SocialDigestGroupKey,
  digestGroupForEventKey,
} from './constants'

export type DigestNotificationRow = {
  eventKey: NotificationEventKey
  title: string
  /** Relative deep-link path (may be empty). Absolutized by the caller. */
  href: string
  createdAt: Date
}

export type DigestGroupSummary = {
  key: SocialDigestGroupKey
  emoji: string
  count: number
  /** Human label, e.g. "3 new likes" or "1 new follower". */
  label: string
}

export type DigestRecentItem = {
  title: string
  href: string
}

export type SocialDigestSummary = {
  totalCount: number
  groups: DigestGroupSummary[]
  recent: DigestRecentItem[]
}

function labelForGroup(group: SocialDigestGroupDef, count: number): string {
  const noun = count === 1 ? group.singular : group.plural
  return count === 1 ? `1 ${noun}` : `${count} ${noun}`
}

export type SummarizeDigestRowsOptions = {
  /** Cap on the recent-activity list (defaults to MAX_DIGEST_RECENT_ITEMS). */
  maxRecentItems?: number
}

/**
 * Group the recipient's unread rows into the digest summary. Rows whose event
 * isn't part of a digest group are ignored (defensive — the query already
 * filters to the digest keys). Each row counts once toward its group; the
 * recent list is the newest rows across all groups.
 */
export function summarizeDigestRows(
  rows: readonly DigestNotificationRow[],
  options: SummarizeDigestRowsOptions = {},
): SocialDigestSummary {
  const maxRecent = Math.max(
    1,
    Math.trunc(options.maxRecentItems ?? MAX_DIGEST_RECENT_ITEMS),
  )

  const countsByGroup = new Map<SocialDigestGroupKey, number>()
  let totalCount = 0

  for (const row of rows) {
    const groupKey = digestGroupForEventKey(row.eventKey)
    if (!groupKey) continue

    countsByGroup.set(groupKey, (countsByGroup.get(groupKey) ?? 0) + 1)
    totalCount += 1
  }

  const groups: DigestGroupSummary[] = []
  for (const group of SOCIAL_DIGEST_GROUPS) {
    const count = countsByGroup.get(group.key) ?? 0
    if (count <= 0) continue

    groups.push({
      key: group.key,
      emoji: group.emoji,
      count,
      label: labelForGroup(group, count),
    })
  }

  const recent = [...rows]
    // Newest first; stable across equal timestamps.
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .filter((row) => digestGroupForEventKey(row.eventKey) !== null)
    .slice(0, maxRecent)
    .map((row) => ({ title: row.title, href: row.href }))

  return { totalCount, groups, recent }
}

/**
 * Short subject/heading phrase from the summary — the two most significant
 * groups, e.g. "3 new likes & 2 new comments", falling back to a generic line.
 */
export function buildDigestHeadline(summary: SocialDigestSummary): string {
  if (summary.groups.length === 0 || summary.totalCount === 0) {
    return 'You have new activity'
  }

  const parts = summary.groups.slice(0, 2).map((group) => group.label)
  const hasMore = summary.groups.length > 2
  const [first, second] = parts

  if (!first) {
    return 'You have new activity'
  }

  if (!second) {
    return hasMore ? `${first} & more` : first
  }

  const joined = `${first} & ${second}`
  return hasMore ? `${joined} & more` : joined
}
