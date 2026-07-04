// lib/looks/featuring.ts
//
// Admin editorial curation for the Looks Spotlight feed (social-first AM1). A
// SUPER_ADMIN can Feature / Unfeature a look; featuredAt drives
// buildLookPostSpotlightEligibilityWhere so a featured look is guaranteed into
// Spotlight without any faked engagement. Repeat calls are forgiving no-ops
// (changed = false), matching the reviews moderation lib's convention.

// Structural db shape: unit-testable with a plain vi.fn() stub, satisfied by the
// real Prisma client. featuredByUserId is a plain admin User id (no relation,
// #481 audit convention).
export type LookFeaturingDb = {
  lookPost: {
    findUnique: (args: {
      where: { id: string }
      select: {
        id: true
        featuredAt: true
        professionalId: true
        serviceId: true
        service: { select: { categoryId: true } }
      }
    }) => Promise<{
      id: string
      featuredAt: Date | null
      professionalId: string
      serviceId: string | null
      service: { categoryId: string } | null
    } | null>
    update: (args: {
      where: { id: string }
      data: { featuredAt: Date | null; featuredByUserId: string | null }
      select: { id: true; featuredAt: true }
    }) => Promise<{ id: string; featuredAt: Date | null }>
  }
}

export type SetLookFeaturedResult =
  | { found: false }
  | {
      found: true
      changed: boolean
      featured: boolean
      featuredAt: Date | null
      professionalId: string
      serviceId: string | null
      categoryId: string | null
    }

export async function setLookPostFeatured(
  db: LookFeaturingDb,
  args: {
    lookPostId: string
    adminUserId: string
    featured: boolean
    now?: Date
  },
): Promise<SetLookFeaturedResult> {
  const existing = await db.lookPost.findUnique({
    where: { id: args.lookPostId },
    select: {
      id: true,
      featuredAt: true,
      professionalId: true,
      serviceId: true,
      service: { select: { categoryId: true } },
    },
  })

  if (!existing) return { found: false }

  const currentlyFeatured = existing.featuredAt !== null
  const scope = {
    professionalId: existing.professionalId,
    serviceId: existing.serviceId,
    categoryId: existing.service?.categoryId ?? null,
  }

  if (currentlyFeatured === args.featured) {
    return {
      found: true,
      changed: false,
      featured: currentlyFeatured,
      featuredAt: existing.featuredAt,
      ...scope,
    }
  }

  const updated = await db.lookPost.update({
    where: { id: args.lookPostId },
    data: args.featured
      ? { featuredAt: args.now ?? new Date(), featuredByUserId: args.adminUserId }
      : { featuredAt: null, featuredByUserId: null },
    select: { id: true, featuredAt: true },
  })

  return {
    found: true,
    changed: true,
    featured: args.featured,
    featuredAt: updated.featuredAt,
    ...scope,
  }
}
