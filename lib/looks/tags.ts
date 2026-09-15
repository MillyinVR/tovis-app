// lib/looks/tags.ts
//
// User-facing hashtag / style tags for Looks (social-first D1). Tags are parsed
// from a look's caption at publish time, normalized to a URL-clean slug, and
// synced onto the LookPost via the implicit M2M. Banned tags (LookTag.bannedAt)
// are never connected, so a banned tag drops out of the look silently and its
// tag page 404s.

import type { Prisma } from '@prisma/client'

// A hashtag token: `#` then 2–30 letters/numbers/underscores (unicode-aware so
// e.g. #Balayage and #90sBlowout both match; the slug strips to ascii below).
const TAG_TOKEN_REGEX = /#([\p{L}\p{N}_]{2,30})/gu

// Keep captions from turning into tag spam / unbounded fan-out on publish.
export const MAX_LOOK_TAGS = 10

export type ParsedLookTag = {
  /** URL-clean key (lowercase ascii alphanumerics). */
  slug: string
  /** First-seen human form, preserved for display. */
  display: string
}

/** Normalize a raw hashtag token to its slug (lowercase, ascii alphanumerics). */
export function slugifyLookTag(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * The floor a slug must clear to name a real tag: below this it is not parsed
 * out of a caption and `/looks/tags/{slug}` does not resolve.
 *
 * One character carries no meaning as a hashtag and collides across wildly
 * different captions (`#a`, `#á`, `#a!` all slug to `a`), so both the parser
 * and the tag page refuse it rather than minting a junk tag.
 */
export const MIN_LOOK_TAG_SLUG_LENGTH = 2

/**
 * Slugify `raw` and answer null when it does not clear MIN_LOOK_TAG_SLUG_LENGTH.
 *
 * This is the single rule behind BOTH "does this caption token become a tag"
 * (`parseLookTags`) and "does `/looks/tags/{raw}` resolve" (`loadLookTagPage`);
 * the two had the same two lines written out separately. It is also the rule
 * tovis-ios's `LooksPath.tagSlug` twins, and the one the generated parity
 * fixture (`schema/parity/lookTagSlugs.json`) pins — so it must stay a single
 * exported function, not a shape re-typed at each call site.
 */
export function resolveLookTagSlug(raw: string): string | null {
  const slug = slugifyLookTag(raw)
  return slug.length >= MIN_LOOK_TAG_SLUG_LENGTH ? slug : null
}

/**
 * Extract distinct `#tags` from a caption, in first-seen order, capped at
 * MAX_LOOK_TAGS. Dedupes by slug; drops slugs that normalize to < 2 chars.
 */
export function parseLookTags(caption: string | null | undefined): ParsedLookTag[] {
  if (!caption) return []

  const seen = new Set<string>()
  const out: ParsedLookTag[] = []

  for (const match of caption.matchAll(TAG_TOKEN_REGEX)) {
    const raw = match[1]
    if (!raw) continue

    const slug = resolveLookTagSlug(raw)
    if (slug === null || seen.has(slug)) continue

    seen.add(slug)
    out.push({ slug, display: raw })
    if (out.length >= MAX_LOOK_TAGS) break
  }

  return out
}

/**
 * Sync a look's tags to `parsed`: upsert each tag by slug (keeping the
 * first-seen display), connect only the non-banned ones, and replace the post's
 * tag set. An empty `parsed` clears the tags (caption edited to remove them).
 * Runs inside the publication transaction.
 */
export async function syncLookTagsForPost(
  tx: Prisma.TransactionClient,
  lookPostId: string,
  parsed: ParsedLookTag[],
): Promise<void> {
  if (parsed.length === 0) {
    await tx.lookPost.update({
      where: { id: lookPostId },
      data: { tags: { set: [] } },
    })
    return
  }

  const tagIds: string[] = []
  for (const { slug, display } of parsed) {
    const tag = await tx.lookTag.upsert({
      where: { slug },
      create: { slug, display },
      update: {}, // keep the first-seen display; never resurrect a banned tag
      select: { id: true, bannedAt: true },
    })
    if (tag.bannedAt === null) tagIds.push(tag.id)
  }

  await tx.lookPost.update({
    where: { id: lookPostId },
    data: { tags: { set: tagIds.map((id) => ({ id })) } },
  })
}
