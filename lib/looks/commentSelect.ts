import { Prisma } from '@prisma/client'

/**
 * Single source of truth for the columns a comment row needs to render in the
 * feed's comment sheet. The `likes` relation is filtered to the viewer's own
 * like (capped at one row) so the mapper can derive `viewerLiked` without a
 * second query; pass `null` for anonymous viewers (matches nothing).
 */
export function buildLookCommentSelect(viewerUserId: string | null) {
  return {
    id: true,
    body: true,
    createdAt: true,
    userId: true,
    parentCommentId: true,
    likeCount: true,
    replyCount: true,
    user: {
      select: {
        id: true,
        clientProfile: {
          select: {
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
        professionalProfile: {
          select: {
            businessName: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    },
    likes: {
      where: { userId: viewerUserId ?? '' },
      select: { id: true },
      take: 1,
    },
  } satisfies Prisma.LookCommentSelect
}

export type LookCommentRow = Prisma.LookCommentGetPayload<{
  select: ReturnType<typeof buildLookCommentSelect>
}>
