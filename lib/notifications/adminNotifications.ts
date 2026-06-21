// lib/notifications/adminNotifications.ts
//
// Emission of admin operational alerts. These are fanned out to every user with
// role ADMIN so admins are pushed (in-app + email; never SMS) instead of having
// to poll dashboards.
//
// Reuse, don't fork: each per-admin inbox row is created through the same shared
// engine as pro/client notifications (createAdminNotification → enqueueDispatch),
// and channel selection flows through the normal channelPolicy / eventKeys
// machinery. The only admin-specific piece is the inbox model + the fan-out.
//
// Idempotency: every emit passes a stable dedupeKey derived from the source
// record id. createAdminNotification treats (adminUserId, dedupeKey) as an
// idempotent inbox upsert and does NOT enqueue a second delivery for an
// already-seen row, so a replayed write never double-notifies an admin.

import {
  NotificationEventKey,
  NotificationRecipientKind,
  Prisma,
  Role,
} from '@prisma/client'

import {
  normDefaultString,
  normInternalHref,
  normNullableString,
  normRequiredString,
  normalizeJsonField,
} from '@/lib/notifications/notificationFields'
import { prisma } from '@/lib/prisma'
import { isUniqueConstraintError } from '@/lib/prismaErrors'

import { enqueueDispatch } from './dispatch/enqueueDispatch'
import { getNotificationEventDefinition } from './eventKeys'

const MAX_ID = 64
const MAX_TITLE = 160
const MAX_BODY = 4000
const MAX_HREF = 2048
const MAX_DEDUPE_KEY = 256
const MAX_LABEL = 160

type DbClient = Prisma.TransactionClient | typeof prisma

const adminNotificationIdSelect = {
  id: true,
} satisfies Prisma.AdminNotificationSelect

const adminUserDispatchSelect = {
  id: true,
  email: true,
  emailVerifiedAt: true,
} satisfies Prisma.UserSelect

type AdminUserDispatchRow = Prisma.UserGetPayload<{
  select: typeof adminUserDispatchSelect
}>

export type CreateAdminNotificationArgs = {
  adminUserId: string
  eventKey: NotificationEventKey
  title: string
  body?: string | null
  href?: string | null
  data?: Prisma.InputJsonValue | null
  dedupeKey?: string | null
  tx?: Prisma.TransactionClient
}

export type AdminNotificationCreateResult = {
  id: string
}

type NormalizedCreateAdminNotificationArgs = ReturnType<
  typeof normalizeCreateAdminNotificationArgs
>

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

async function withAdminNotificationTx<T>(
  tx: Prisma.TransactionClient | undefined,
  work: (db: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (tx) {
    return work(tx)
  }

  return prisma.$transaction(work)
}

function normalizeCreateAdminNotificationArgs(args: CreateAdminNotificationArgs) {
  const adminUserId = normRequiredString(args.adminUserId, MAX_ID)
  const title = normRequiredString(args.title, MAX_TITLE)

  if (!adminUserId) {
    throw new Error('createAdminNotification: missing adminUserId')
  }

  if (!title) {
    throw new Error('createAdminNotification: missing title')
  }

  return {
    adminUserId,
    eventKey: args.eventKey,
    priority: getNotificationEventDefinition(args.eventKey).defaultPriority,
    title,
    body: normDefaultString(args.body, MAX_BODY),
    href: normInternalHref(args.href, MAX_HREF),
    data: args.data,
    dedupeKey: normNullableString(args.dedupeKey, MAX_DEDUPE_KEY),
  }
}

function buildAdminNotificationCreateData(
  normalized: NormalizedCreateAdminNotificationArgs,
): Prisma.AdminNotificationUncheckedCreateInput {
  const data = normalizeJsonField(normalized.data)

  return {
    adminUserId: normalized.adminUserId,
    eventKey: normalized.eventKey,
    priority: normalized.priority,
    title: normalized.title,
    body: normalized.body,
    href: normalized.href,
    dedupeKey: normalized.dedupeKey,

    seenAt: null,
    readAt: null,
    clickedAt: null,
    archivedAt: null,

    ...(data !== undefined ? { data } : {}),
  }
}

function buildAdminNotificationUpdateData(
  normalized: NormalizedCreateAdminNotificationArgs,
): Prisma.AdminNotificationUncheckedUpdateManyInput {
  const data = normalizeJsonField(normalized.data)

  const update: Prisma.AdminNotificationUncheckedUpdateManyInput = {
    eventKey: normalized.eventKey,
    priority: normalized.priority,
    title: normalized.title,
    body: normalized.body,
    href: normalized.href,
    dedupeKey: normalized.dedupeKey,

    seenAt: null,
    readAt: null,
    clickedAt: null,
    archivedAt: null,
  }

  if (data !== undefined) {
    update.data = data
  }

  return update
}

async function findAdminNotificationIdByDedupe(args: {
  adminUserId: string
  dedupeKey: string
  tx?: Prisma.TransactionClient
}): Promise<AdminNotificationCreateResult> {
  const db = getDb(args.tx)

  const found = await db.adminNotification.findFirst({
    where: {
      adminUserId: args.adminUserId,
      dedupeKey: args.dedupeKey,
    },
    select: adminNotificationIdSelect,
  })

  if (!found) {
    throw new Error(
      'createAdminNotification: notification not found after dedupe update/create',
    )
  }

  return found
}

async function getAdminUserDispatchRecipient(args: {
  adminUserId: string
  tx?: Prisma.TransactionClient
}): Promise<AdminUserDispatchRow> {
  const db = getDb(args.tx)

  const user = await db.user.findUnique({
    where: { id: args.adminUserId },
    select: adminUserDispatchSelect,
  })

  if (!user) {
    throw new Error(
      'createAdminNotification: admin user not found for dispatch enqueue',
    )
  }

  return user
}

async function enqueueNewAdminNotificationDispatch(args: {
  notificationId: string
  normalized: NormalizedCreateAdminNotificationArgs
  adminUser: AdminUserDispatchRow
  tx?: Prisma.TransactionClient
}): Promise<void> {
  await enqueueDispatch({
    key: args.normalized.eventKey,
    sourceKey: `admin-notification:${args.notificationId}`,
    recipient: {
      kind: NotificationRecipientKind.ADMIN,
      adminUserId: args.adminUser.id,
      userId: args.adminUser.id,
      inAppTargetId: args.adminUser.id,
      // Admins never receive SMS — no phone capability is supplied.
      email: args.adminUser.email,
      emailVerifiedAt: args.adminUser.emailVerifiedAt,
      timeZone: null,
      // Admins have no per-event preference table: default channels apply.
      preference: null,
    },
    title: args.normalized.title,
    body: args.normalized.body,
    href: args.normalized.href,
    payload: args.normalized.data,
    priority: args.normalized.priority,
    adminNotificationId: args.notificationId,
    tx: args.tx,
  })
}

async function createAndDispatchAdminNotification(args: {
  normalizedForCreate: NormalizedCreateAdminNotificationArgs
  tx: Prisma.TransactionClient
}): Promise<AdminNotificationCreateResult> {
  const adminUser = await getAdminUserDispatchRecipient({
    adminUserId: args.normalizedForCreate.adminUserId,
    tx: args.tx,
  })

  const created = await args.tx.adminNotification.create({
    data: buildAdminNotificationCreateData(args.normalizedForCreate),
    select: adminNotificationIdSelect,
  })

  await enqueueNewAdminNotificationDispatch({
    notificationId: created.id,
    normalized: args.normalizedForCreate,
    adminUser,
    tx: args.tx,
  })

  return created
}

/**
 * Idempotent admin notification creation. Mirrors createProNotification /
 * createClientNotification:
 * - No dedupeKey → always creates a new row and enqueues delivery.
 * - With dedupeKey → idempotent inbox upsert keyed by (adminUserId, dedupeKey);
 *   a deduped update refreshes the existing row only and does NOT enqueue a
 *   second delivery cycle.
 */
export async function createAdminNotification(
  args: CreateAdminNotificationArgs,
): Promise<AdminNotificationCreateResult> {
  return withAdminNotificationTx(args.tx, async (tx) => {
    const normalized = normalizeCreateAdminNotificationArgs(args)

    if (!normalized.dedupeKey) {
      return createAndDispatchAdminNotification({
        normalizedForCreate: { ...normalized, dedupeKey: null },
        tx,
      })
    }

    const updated = await tx.adminNotification.updateMany({
      where: {
        adminUserId: normalized.adminUserId,
        dedupeKey: normalized.dedupeKey,
      },
      data: buildAdminNotificationUpdateData(normalized),
    })

    if (updated.count > 0) {
      return findAdminNotificationIdByDedupe({
        adminUserId: normalized.adminUserId,
        dedupeKey: normalized.dedupeKey,
        tx,
      })
    }

    try {
      return await createAndDispatchAdminNotification({
        normalizedForCreate: normalized,
        tx,
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error
      }

      await tx.adminNotification.updateMany({
        where: {
          adminUserId: normalized.adminUserId,
          dedupeKey: normalized.dedupeKey,
        },
        data: buildAdminNotificationUpdateData(normalized),
      })

      return findAdminNotificationIdByDedupe({
        adminUserId: normalized.adminUserId,
        dedupeKey: normalized.dedupeKey,
        tx,
      })
    }
  })
}

async function listAdminUserIds(db: DbClient): Promise<string[]> {
  const admins = await db.user.findMany({
    where: { role: Role.ADMIN },
    select: { id: true },
  })

  return admins.map((admin) => admin.id)
}

/**
 * Fans an operational alert out to every admin. Each admin gets their own
 * idempotent inbox row keyed by (adminUserId, dedupeKey). Returns the number of
 * admins notified (0 is a valid no-op when there are no admins).
 */
async function fanOutAdminNotification(args: {
  tx?: Prisma.TransactionClient
  eventKey: NotificationEventKey
  title: string
  body: string
  href: string
  dedupeKey: string
  data?: Prisma.InputJsonValue | null
}): Promise<{ notified: number }> {
  const adminUserIds = await listAdminUserIds(getDb(args.tx))

  for (const adminUserId of adminUserIds) {
    await createAdminNotification({
      adminUserId,
      eventKey: args.eventKey,
      title: args.title,
      body: args.body,
      href: args.href,
      data: args.data,
      dedupeKey: args.dedupeKey,
      tx: args.tx,
    })
  }

  return { notified: adminUserIds.length }
}

/**
 * A pro submitted a verification document, or edited their license (re-review).
 * `verificationDocumentId` is present for a document upload and absent for a
 * license-edit re-review; it drives the dedupeKey so each distinct review need
 * collapses to one outstanding alert per admin.
 */
export async function emitAdminVerificationReviewNeeded(args: {
  professionalId: string
  verificationDocumentId?: string | null
  tx?: Prisma.TransactionClient
}): Promise<void> {
  const professionalId = normRequiredString(args.professionalId, MAX_ID)
  if (!professionalId) return

  const documentId = normNullableString(args.verificationDocumentId, MAX_ID)

  const dedupeKey = documentId
    ? `ADMIN_VERIFICATION_REVIEW_NEEDED:doc:${documentId}`
    : `ADMIN_VERIFICATION_REVIEW_NEEDED:license:${professionalId}`

  await fanOutAdminNotification({
    tx: args.tx,
    eventKey: NotificationEventKey.ADMIN_VERIFICATION_REVIEW_NEEDED,
    title: documentId
      ? 'Verification document to review'
      : 'License re-review needed',
    body: documentId
      ? 'A professional submitted a verification document that needs review.'
      : 'A professional updated their license and needs re-review.',
    href: `/admin/professionals/${professionalId}`,
    dedupeKey,
    data: {
      professionalId,
      ...(documentId ? { verificationDocumentId: documentId } : {}),
      notificationReason: 'ADMIN_VERIFICATION_REVIEW_NEEDED',
    },
  })
}

/**
 * A new support ticket was created.
 */
export async function emitAdminSupportTicketCreated(args: {
  ticketId: string
  subject?: string | null
  tx?: Prisma.TransactionClient
}): Promise<void> {
  const ticketId = normRequiredString(args.ticketId, MAX_ID)
  if (!ticketId) return

  const subject = normNullableString(args.subject, MAX_LABEL)

  await fanOutAdminNotification({
    tx: args.tx,
    eventKey: NotificationEventKey.ADMIN_SUPPORT_TICKET_CREATED,
    title: 'New support ticket',
    body: subject
      ? `A new support ticket was opened: ${subject}`
      : 'A new support ticket was opened.',
    href: `/admin/support/${ticketId}`,
    dedupeKey: `ADMIN_SUPPORT_TICKET_CREATED:${ticketId}`,
    data: {
      ticketId,
      notificationReason: 'ADMIN_SUPPORT_TICKET_CREATED',
    },
  })
}

/**
 * A new viral-service request is pending an admin decision.
 */
export async function emitAdminViralRequestPending(args: {
  requestId: string
  name?: string | null
  tx?: Prisma.TransactionClient
}): Promise<void> {
  const requestId = normRequiredString(args.requestId, MAX_ID)
  if (!requestId) return

  const name = normNullableString(args.name, MAX_LABEL)

  await fanOutAdminNotification({
    tx: args.tx,
    eventKey: NotificationEventKey.ADMIN_VIRAL_REQUEST_PENDING,
    title: 'Viral service request pending',
    body: name
      ? `A new viral service request is pending review: ${name}`
      : 'A new viral service request is pending review.',
    href: '/admin',
    dedupeKey: `ADMIN_VIRAL_REQUEST_PENDING:${requestId}`,
    data: {
      requestId,
      notificationReason: 'ADMIN_VIRAL_REQUEST_PENDING',
    },
  })
}
