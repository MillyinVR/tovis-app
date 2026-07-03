// lib/jobs/looksSocial/fanOutNewLook.ts
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  NotificationEventKey,
  Prisma,
  PrismaClient,
} from '@prisma/client'

import {
  createClientNotification,
  type CreateClientNotificationArgs,
} from '@/lib/notifications/clientNotifications'
import { normalizeRequiredId } from '@/lib/guards'

type FanOutNewLookDb = PrismaClient | Prisma.TransactionClient

const MAX_SNIPPET = 140

export type ProcessFanOutNewLookNotificationsResult = {
  lookPostId: string
  /** Followers that received (or refreshed) a notification. */
  notifiedCount: number
  /** Followers skipped because they are the pro's own client identity. */
  skippedSelfCount: number
  skippedReason:
    | 'LOOK_NOT_FOUND'
    | 'LOOK_NOT_ELIGIBLE'
    | 'CLIENT_AUTHORED_LOOK'
    | null
}

export const fanOutNewLookSelect = Prisma.validator<Prisma.LookPostSelect>()({
  id: true,
  professionalId: true,
  clientAuthorId: true,
  caption: true,
  status: true,
  visibility: true,
  moderationStatus: true,
  publishedAt: true,
  removedAt: true,
  professional: {
    select: {
      user: {
        select: {
          clientProfile: { select: { id: true } },
        },
      },
    },
  },
})

export type FanOutNewLookRow = Prisma.LookPostGetPayload<{
  select: typeof fanOutNewLookSelect
}>

/**
 * Fan-out eligibility mirrors feed eligibility (buildLooksFeedWhere): the job
 * runs asynchronously, so the look may have been unpublished, removed, or
 * moderated between enqueue and processing — never notify followers about a
 * look they can't open. FOLLOWERS_ONLY is fine (the recipients ARE followers);
 * UNLISTED is not.
 */
export function isFanOutEligibleLook(
  look: Pick<
    FanOutNewLookRow,
    'status' | 'moderationStatus' | 'publishedAt' | 'removedAt' | 'visibility'
  >,
): boolean {
  return (
    look.status === LookPostStatus.PUBLISHED &&
    look.moderationStatus === ModerationStatus.APPROVED &&
    look.publishedAt !== null &&
    look.removedAt === null &&
    look.visibility !== LookPostVisibility.UNLISTED
  )
}

/** Collapses whitespace and truncates the (public) caption for the body. */
function toCaptionSnippet(caption: string | null): string | null {
  if (!caption) return null
  const collapsed = caption.replace(/\s+/g, ' ').trim()
  if (!collapsed) return null
  if (collapsed.length <= MAX_SNIPPET) return collapsed
  return `${collapsed.slice(0, MAX_SNIPPET - 1).trimEnd()}…`
}

/**
 * The LOOK_NEW_FROM_FOLLOWED_PRO notification one follower receives. Name-free
 * title (surfaces resolve the pro at render time via data.professionalId); the
 * caption is public content on the look so a snippet rides along as the body.
 * The per-look dedupeKey makes a job retry (or unpublish→republish) refresh
 * each follower's row instead of stacking duplicates.
 */
export function buildNewLookClientNotificationArgs(args: {
  clientId: string
  look: Pick<FanOutNewLookRow, 'id' | 'professionalId' | 'caption'>
}): CreateClientNotificationArgs {
  const lookPostId = normalizeRequiredId('lookPostId', args.look.id)

  return {
    clientId: normalizeRequiredId('clientId', args.clientId),
    eventKey: NotificationEventKey.LOOK_NEW_FROM_FOLLOWED_PRO,
    title: 'New look from a pro you follow',
    body: toCaptionSnippet(args.look.caption),
    href: `/looks/${encodeURIComponent(lookPostId)}`,
    dedupeKey: `look:${lookPostId}:new-look`,
    data: {
      lookPostId,
      professionalId: args.look.professionalId,
    },
  }
}

/**
 * LOOK_NEW_FROM_FOLLOWED_PRO → every ProFollow follower of the look's pro.
 *
 * Runs from the LooksSocialJob queue (FAN_OUT_NEW_LOOK_NOTIFICATIONS), enqueued
 * on publish by the mutation policy. Idempotent end to end: the job dedupes per
 * look and each follower notification dedupes per look+client. Client-authored
 * looks are excluded for now: they are gated out of the public feed until the
 * C2 step unlocks them.
 */
export async function processFanOutNewLookNotifications(
  db: FanOutNewLookDb,
  args: { lookPostId: string },
): Promise<ProcessFanOutNewLookNotificationsResult> {
  const lookPostId = normalizeRequiredId('lookPostId', args.lookPostId)

  const look = await db.lookPost.findUnique({
    where: { id: lookPostId },
    select: fanOutNewLookSelect,
  })

  if (!look) {
    return {
      lookPostId,
      notifiedCount: 0,
      skippedSelfCount: 0,
      skippedReason: 'LOOK_NOT_FOUND',
    }
  }

  if (look.clientAuthorId) {
    return {
      lookPostId,
      notifiedCount: 0,
      skippedSelfCount: 0,
      skippedReason: 'CLIENT_AUTHORED_LOOK',
    }
  }

  if (!isFanOutEligibleLook(look)) {
    return {
      lookPostId,
      notifiedCount: 0,
      skippedSelfCount: 0,
      skippedReason: 'LOOK_NOT_ELIGIBLE',
    }
  }

  const followers = await db.proFollow.findMany({
    where: { professionalId: look.professionalId },
    select: { clientId: true },
    orderBy: [{ createdAt: 'asc' }],
  })

  // A pro's own client identity may follow their pro profile — that would be a
  // self-notification.
  const proOwnClientId = look.professional.user.clientProfile?.id ?? null

  let notifiedCount = 0
  let skippedSelfCount = 0

  for (const follower of followers) {
    if (proOwnClientId && follower.clientId === proOwnClientId) {
      skippedSelfCount += 1
      continue
    }

    // Each notification commits in its own short tx (the standard
    // emit-outside-the-write-tx convention); a mid-batch retry is safe because
    // already-notified followers dedupe into a refresh.
    await createClientNotification(
      buildNewLookClientNotificationArgs({
        clientId: follower.clientId,
        look,
      }),
    )

    notifiedCount += 1
  }

  return {
    lookPostId,
    notifiedCount,
    skippedSelfCount,
    skippedReason: null,
  }
}
