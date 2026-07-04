// lib/adminModeration/lookReports.ts
//
// Report-resolution helpers for the admin Looks moderation queue (social-first
// AM1). "Dismiss reports" marks every outstanding (unresolved) report on a look
// or comment as resolved without changing the target's moderation status — the
// admin reviewed the reports and is keeping the content live. Repeat calls are
// forgiving no-ops (dismissedCount = 0), mirroring the reviews lib's `had*`
// pattern so the UI never has to pre-check state.

// Minimal structural db shapes so these helpers are unit-testable with plain
// vi.fn() stubs (no `as` casts) AND satisfied by the real Prisma client.
export type DismissLookPostReportsDb = {
  lookPost: {
    findUnique: (args: {
      where: { id: string }
      select: { id: true; professionalId: true; serviceId: true }
    }) => Promise<{
      id: string
      professionalId: string
      serviceId: string | null
    } | null>
  }
  lookPostReport: {
    updateMany: (args: {
      where: { lookPostId: string; resolvedAt: null }
      data: { resolvedAt: Date; resolvedByUserId: string }
    }) => Promise<{ count: number }>
  }
}

export type DismissLookCommentReportsDb = {
  lookComment: {
    findUnique: (args: {
      where: { id: string }
      select: {
        id: true
        lookPost: { select: { professionalId: true; serviceId: true } }
      }
    }) => Promise<{
      id: string
      lookPost: { professionalId: string; serviceId: string | null }
    } | null>
  }
  lookCommentReport: {
    updateMany: (args: {
      where: { lookCommentId: string; resolvedAt: null }
      data: { resolvedAt: Date; resolvedByUserId: string }
    }) => Promise<{ count: number }>
  }
}

export type DismissReportsResult =
  | { found: false }
  | {
      found: true
      dismissedCount: number
      professionalId: string
      serviceId: string | null
    }

export async function dismissLookPostReports(
  db: DismissLookPostReportsDb,
  args: { lookPostId: string; adminUserId: string; now?: Date },
): Promise<DismissReportsResult> {
  const existing = await db.lookPost.findUnique({
    where: { id: args.lookPostId },
    select: { id: true, professionalId: true, serviceId: true },
  })

  if (!existing) return { found: false }

  const { count } = await db.lookPostReport.updateMany({
    where: { lookPostId: args.lookPostId, resolvedAt: null },
    data: {
      resolvedAt: args.now ?? new Date(),
      resolvedByUserId: args.adminUserId,
    },
  })

  return {
    found: true,
    dismissedCount: count,
    professionalId: existing.professionalId,
    serviceId: existing.serviceId,
  }
}

export async function dismissLookCommentReports(
  db: DismissLookCommentReportsDb,
  args: { lookCommentId: string; adminUserId: string; now?: Date },
): Promise<DismissReportsResult> {
  const existing = await db.lookComment.findUnique({
    where: { id: args.lookCommentId },
    select: {
      id: true,
      lookPost: { select: { professionalId: true, serviceId: true } },
    },
  })

  if (!existing) return { found: false }

  const { count } = await db.lookCommentReport.updateMany({
    where: { lookCommentId: args.lookCommentId, resolvedAt: null },
    data: {
      resolvedAt: args.now ?? new Date(),
      resolvedByUserId: args.adminUserId,
    },
  })

  return {
    found: true,
    dismissedCount: count,
    professionalId: existing.lookPost.professionalId,
    serviceId: existing.lookPost.serviceId,
  }
}
