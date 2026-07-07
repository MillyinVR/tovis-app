// lib/looks/adminTags.ts
//
// SUPER_ADMIN control plane for the user-facing tag layer (social-first D1). Ban
// enforcement already lives at the data layer (LookTag.bannedAt drops a tag at
// publish + 404s its page); this module is the operator surface behind
// /admin/looks → Tags: list, ban/unban, rename the display label, and merge one
// tag's looks into another. Tags are global (no tenant/PII dimension), so these
// are plain LookTag reads/writes — no cross-tenant or privacy boundary needed.

import { Prisma } from '@prisma/client'

import { slugifyLookTag } from '@/lib/looks/tags'
import { prisma } from '@/lib/prisma'

export type AdminLookTagDto = {
  slug: string
  display: string
  /** Number of looks connected to the tag (includes non-public looks). */
  lookCount: number
  banned: boolean
  bannedAt: string | null
  createdAt: string
}

export type AdminLookTagBannedFilter = 'ALL' | 'ACTIVE' | 'BANNED'

export function isAdminLookTagBannedFilter(
  value: unknown,
): value is AdminLookTagBannedFilter {
  return value === 'ALL' || value === 'ACTIVE' || value === 'BANNED'
}

const LIST_LIMIT = 200

const adminLookTagSelect = Prisma.validator<Prisma.LookTagSelect>()({
  slug: true,
  display: true,
  bannedAt: true,
  createdAt: true,
  _count: { select: { looks: true } },
})

type AdminLookTagRow = Prisma.LookTagGetPayload<{
  select: typeof adminLookTagSelect
}>

function toDto(row: AdminLookTagRow): AdminLookTagDto {
  return {
    slug: row.slug,
    display: row.display,
    lookCount: row._count.looks,
    banned: row.bannedAt !== null,
    bannedAt: row.bannedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Lists tags for the admin queue, most-used first. `q` matches slug OR display
 * (case-insensitive contains); `banned` narrows to active/banned tags.
 */
export async function listAdminLookTags(args: {
  q?: string
  banned?: AdminLookTagBannedFilter
}): Promise<AdminLookTagDto[]> {
  const q = (args.q ?? '').trim()
  const banned = args.banned ?? 'ALL'

  const where: Prisma.LookTagWhereInput = {}
  if (q) {
    where.OR = [
      { slug: { contains: slugifyLookTag(q) } },
      { display: { contains: q, mode: 'insensitive' } },
    ]
  }
  if (banned === 'ACTIVE') where.bannedAt = null
  if (banned === 'BANNED') where.bannedAt = { not: null }

  const rows = await prisma.lookTag.findMany({
    where,
    select: adminLookTagSelect,
    orderBy: [{ looks: { _count: 'desc' } }, { createdAt: 'desc' }],
    take: LIST_LIMIT,
  })

  return rows.map(toDto)
}

export type AdminLookTagActionResult =
  | { ok: true; tag: AdminLookTagDto }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT'; message: string }

async function loadDto(slug: string): Promise<AdminLookTagDto | null> {
  const row = await prisma.lookTag.findUnique({
    where: { slug },
    select: adminLookTagSelect,
  })
  return row ? toDto(row) : null
}

/** Ban (bannedAt set) or unban (cleared) a tag. Idempotent. */
export async function setLookTagBanned(args: {
  slug: string
  banned: boolean
  now: Date
}): Promise<AdminLookTagActionResult> {
  const slug = slugifyLookTag(args.slug)
  if (slug.length < 2) {
    return { ok: false, code: 'INVALID', message: 'Invalid tag slug.' }
  }

  const existing = await prisma.lookTag.findUnique({
    where: { slug },
    select: { slug: true },
  })
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Tag not found.' }
  }

  await prisma.lookTag.update({
    where: { slug },
    data: { bannedAt: args.banned ? args.now : null },
  })

  const tag = await loadDto(slug)
  if (!tag) return { ok: false, code: 'NOT_FOUND', message: 'Tag not found.' }
  return { ok: true, tag }
}

const MAX_DISPLAY_LENGTH = 40

/** Rename only the display label (the slug — the URL key — is immutable). */
export async function renameLookTag(args: {
  slug: string
  display: string
}): Promise<AdminLookTagActionResult> {
  const slug = slugifyLookTag(args.slug)
  if (slug.length < 2) {
    return { ok: false, code: 'INVALID', message: 'Invalid tag slug.' }
  }

  const display = args.display.trim()
  if (!display) {
    return { ok: false, code: 'INVALID', message: 'A display label is required.' }
  }
  if (display.length > MAX_DISPLAY_LENGTH) {
    return {
      ok: false,
      code: 'INVALID',
      message: `Display label must be ${MAX_DISPLAY_LENGTH} characters or fewer.`,
    }
  }
  // The display must still normalize to the same slug — renaming is a relabel,
  // not a re-slug (which would orphan the tag's URL + look connections).
  if (slugifyLookTag(display) !== slug) {
    return {
      ok: false,
      code: 'INVALID',
      message: `Display label must still normalize to "${slug}".`,
    }
  }

  const existing = await prisma.lookTag.findUnique({
    where: { slug },
    select: { slug: true },
  })
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Tag not found.' }
  }

  await prisma.lookTag.update({ where: { slug }, data: { display } })

  const tag = await loadDto(slug)
  if (!tag) return { ok: false, code: 'NOT_FOUND', message: 'Tag not found.' }
  return { ok: true, tag }
}

export type AdminLookTagMergeResult =
  | { ok: true; tag: AdminLookTagDto; movedLookCount: number }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT'; message: string }

/**
 * Merges `fromSlug` into `toSlug`: every look connected to the source tag is
 * connected to the target (idempotent — already-connected looks are no-ops),
 * then the source tag is deleted. The target's display label is kept.
 */
export async function mergeLookTags(args: {
  fromSlug: string
  toSlug: string
}): Promise<AdminLookTagMergeResult> {
  const fromSlug = slugifyLookTag(args.fromSlug)
  const toSlug = slugifyLookTag(args.toSlug)

  if (fromSlug.length < 2 || toSlug.length < 2) {
    return { ok: false, code: 'INVALID', message: 'Invalid tag slug.' }
  }
  if (fromSlug === toSlug) {
    return { ok: false, code: 'INVALID', message: 'Cannot merge a tag into itself.' }
  }

  return prisma.$transaction(async (tx) => {
    const from = await tx.lookTag.findUnique({
      where: { slug: fromSlug },
      select: { id: true, looks: { select: { id: true } } },
    })
    const to = await tx.lookTag.findUnique({
      where: { slug: toSlug },
      select: { id: true },
    })
    if (!from || !to) {
      return {
        ok: false as const,
        code: 'NOT_FOUND' as const,
        message: 'Both the source and target tag must exist.',
      }
    }

    if (from.looks.length > 0) {
      await tx.lookTag.update({
        where: { id: to.id },
        data: { looks: { connect: from.looks.map((look) => ({ id: look.id })) } },
      })
    }

    await tx.lookTag.delete({ where: { id: from.id } })

    const row = await tx.lookTag.findUnique({
      where: { slug: toSlug },
      select: adminLookTagSelect,
    })
    if (!row) {
      return {
        ok: false as const,
        code: 'NOT_FOUND' as const,
        message: 'Target tag not found after merge.',
      }
    }

    return {
      ok: true as const,
      tag: toDto(row),
      movedLookCount: from.looks.length,
    }
  })
}
