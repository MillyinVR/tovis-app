import {
  normDefaultString,
  normInternalHref,
  normNullableString,
  normRequiredString,
  normalizeJsonField,
} from '@/lib/notifications/notificationFields'
import { prisma } from '@/lib/prisma'
import { isUniqueConstraintError } from '@/lib/prismaErrors'
import { pickTimeZoneOrNull } from '@/lib/timeZone'
import {
  NotificationEventKey,
  NotificationPriority,
  NotificationRecipientKind,
  Prisma,
} from '@prisma/client'

import { enqueueDispatch } from './dispatch/enqueueDispatch'
import { getNotificationEventDefinition } from './eventKeys'

const MAX_ID = 64
const MAX_TITLE = 160
const MAX_BODY = 4000
const MAX_HREF = 2048
const MAX_DEDUPE_KEY = 256

const notificationIdSelect = {
  id: true,
} satisfies Prisma.NotificationSelect

const professionalDispatchRecipientSelect = {
  id: true,
  userId: true,
  homeTenantId: true,
  phone: true,
  phoneVerifiedAt: true,
  timeZone: true,
  user: {
    select: {
      email: true,
      emailVerifiedAt: true,
      phone: true,
      phoneVerifiedAt: true,
    },
  },
} satisfies Prisma.ProfessionalProfileSelect

const professionalNotificationPreferenceSelect = {
  inAppEnabled: true,
  smsEnabled: true,
  emailEnabled: true,
  quietHoursStartMinutes: true,
  quietHoursEndMinutes: true,
} satisfies Prisma.ProfessionalNotificationPreferenceSelect

export type CreateProNotificationArgs = {
  professionalId: string
  eventKey: NotificationEventKey
  priority?: NotificationPriority | null

  title: string
  body?: string | null
  href?: string | null
  data?: Prisma.InputJsonValue | null

  dedupeKey?: string | null

  actorUserId?: string | null
  bookingId?: string | null
  reviewId?: string | null

  tx?: Prisma.TransactionClient
}

export type ProNotificationCreateResult = {
  id: string
}

type DbClient = Prisma.TransactionClient | typeof prisma

type NormalizedCreateArgs = ReturnType<typeof normalizeCreateArgs>

type ProfessionalDispatchRecipientRow = Prisma.ProfessionalProfileGetPayload<{
  select: typeof professionalDispatchRecipientSelect
}>

type ProfessionalNotificationPreferenceRow =
  Prisma.ProfessionalNotificationPreferenceGetPayload<{
    select: typeof professionalNotificationPreferenceSelect
  }>

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

async function withProNotificationTx<T>(
  tx: Prisma.TransactionClient | undefined,
  work: (db: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (tx) {
    return work(tx)
  }

  return prisma.$transaction(work)
}

function buildUpdateData(
  normalized: NormalizedCreateArgs,
): Prisma.NotificationUncheckedUpdateManyInput {
  const data = normalizeJsonField(normalized.data)

  const update: Prisma.NotificationUncheckedUpdateManyInput = {
    eventKey: normalized.eventKey,
    priority: normalized.priority,
    title: normalized.title,
    body: normalized.body,
    href: normalized.href,
    dedupeKey: normalized.dedupeKey,
    actorUserId: normalized.actorUserId,
    bookingId: normalized.bookingId,
    reviewId: normalized.reviewId,

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

function buildCreateData(
  normalized: NormalizedCreateArgs,
  proTenantId: string,
): Prisma.NotificationUncheckedCreateInput {
  const data = normalizeJsonField(normalized.data)

  return {
    professionalId: normalized.professionalId,
    proTenantId,
    eventKey: normalized.eventKey,
    priority: normalized.priority,
    title: normalized.title,
    body: normalized.body,
    href: normalized.href,
    dedupeKey: normalized.dedupeKey,
    actorUserId: normalized.actorUserId,
    bookingId: normalized.bookingId,
    reviewId: normalized.reviewId,

    seenAt: null,
    readAt: null,
    clickedAt: null,
    archivedAt: null,

    ...(data !== undefined ? { data } : {}),
  }
}

function normalizeCreateArgs(args: CreateProNotificationArgs) {
  const definition = getNotificationEventDefinition(args.eventKey)
  const professionalId = normRequiredString(args.professionalId, MAX_ID)
  const title = normRequiredString(args.title, MAX_TITLE)

  if (!professionalId) {
    throw new Error('createProNotification: missing professionalId')
  }

  if (!title) {
    throw new Error('createProNotification: missing title')
  }

  return {
    professionalId,
    eventKey: args.eventKey,
    priority: args.priority ?? definition.defaultPriority,

    title,
    body: normDefaultString(args.body, MAX_BODY),
    href: normInternalHref(args.href, MAX_HREF),
    data: args.data,

    dedupeKey: normNullableString(args.dedupeKey, MAX_DEDUPE_KEY),

    actorUserId: normNullableString(args.actorUserId, MAX_ID),
    bookingId: normNullableString(args.bookingId, MAX_ID),
    reviewId: normNullableString(args.reviewId, MAX_ID),
  }
}

async function findNotificationIdByDedupe(args: {
  professionalId: string
  dedupeKey: string
  tx?: Prisma.TransactionClient
}): Promise<ProNotificationCreateResult> {
  const db = getDb(args.tx)

  const found = await db.notification.findFirst({
    where: {
      professionalId: args.professionalId,
      dedupeKey: args.dedupeKey,
    },
    select: notificationIdSelect,
  })

  if (!found) {
    throw new Error(
      'createProNotification: notification not found after dedupe update/create',
    )
  }

  return found
}

async function getProfessionalDispatchRecipient(args: {
  professionalId: string
  eventKey: NotificationEventKey
  tx?: Prisma.TransactionClient
}): Promise<{
  professional: ProfessionalDispatchRecipientRow
  preference: ProfessionalNotificationPreferenceRow | null
}> {
  const db = getDb(args.tx)

  const [professional, preference] = await Promise.all([
    db.professionalProfile.findUnique({
      where: {
        id: args.professionalId,
      },
      select: professionalDispatchRecipientSelect,
    }),
    db.professionalNotificationPreference.findUnique({
      where: {
        professionalId_eventKey: {
          professionalId: args.professionalId,
          eventKey: args.eventKey,
        },
      },
      select: professionalNotificationPreferenceSelect,
    }),
  ])

  if (!professional) {
    throw new Error(
      'createProNotification: professional not found for dispatch enqueue',
    )
  }

  return {
    professional,
    preference,
  }
}

function resolvePreferredPhone(
  professional: ProfessionalDispatchRecipientRow,
): {
  phone: string | null
  phoneVerifiedAt: Date | null
} {
  const profilePhone = normNullableString(professional.phone, 64)
  if (profilePhone) {
    return {
      phone: profilePhone,
      phoneVerifiedAt: professional.phoneVerifiedAt ?? null,
    }
  }

  const userPhone = normNullableString(professional.user.phone, 64)
  return {
    phone: userPhone,
    phoneVerifiedAt: professional.user.phoneVerifiedAt ?? null,
  }
}

async function enqueueNewProNotificationDispatch(args: {
  notificationId: string
  normalized: NormalizedCreateArgs
  professional: ProfessionalDispatchRecipientRow
  preference: ProfessionalNotificationPreferenceRow | null
  tx?: Prisma.TransactionClient
}): Promise<void> {
  const { professional, preference } = args

  const preferredPhone = resolvePreferredPhone(professional)

  await enqueueDispatch({
    key: args.normalized.eventKey,
    sourceKey: `pro-notification:${args.notificationId}`,
    recipient: {
      kind: NotificationRecipientKind.PRO,
      professionalId: professional.id,
      userId: professional.userId,
      inAppTargetId: professional.id,
      phone: preferredPhone.phone,
      phoneVerifiedAt: preferredPhone.phoneVerifiedAt,
      email: professional.user.email,
      emailVerifiedAt: professional.user.emailVerifiedAt,
      timeZone: pickTimeZoneOrNull(professional.timeZone),
      preference,
    },
    title: args.normalized.title,
    body: args.normalized.body,
    href: args.normalized.href,
    payload: args.normalized.data,
    priority: args.normalized.priority,
    notificationId: args.notificationId,
    tx: args.tx,
  })
}

/**
 * Creates a brand-new inbox row and enqueues its first delivery cycle.
 *
 * Loads the professional once and reuses that row for both the tenant
 * attribution snapshot (proTenantId mirrors the Pro's home tenant) and the
 * dispatch recipient — avoiding a second profile lookup. The load happens
 * before the insert because proTenantId is written at create time; a missing
 * profile is a caller data-integrity bug and throws rather than writing a null
 * tenant snapshot.
 */
async function createAndDispatchProNotification(args: {
  normalizedForCreate: NormalizedCreateArgs
  tx: Prisma.TransactionClient
}): Promise<ProNotificationCreateResult> {
  const { professional, preference } = await getProfessionalDispatchRecipient({
    professionalId: args.normalizedForCreate.professionalId,
    eventKey: args.normalizedForCreate.eventKey,
    tx: args.tx,
  })

  const created = await args.tx.notification.create({
    data: buildCreateData(args.normalizedForCreate, professional.homeTenantId),
    select: notificationIdSelect,
  })

  await enqueueNewProNotificationDispatch({
    notificationId: created.id,
    normalized: args.normalizedForCreate,
    professional,
    preference,
    tx: args.tx,
  })

  return created
}

/**
 * Idempotent pro notification creation.
 *
 * Contract:
 * - If dedupeKey is absent, always creates a new row and enqueues delivery.
 * - If dedupeKey is present, behaves as an idempotent inbox upsert keyed by
 *   (professionalId, dedupeKey) and resets unread state.
 *
 * Important behavior:
 * - A deduped update refreshes the existing inbox row only.
 * - It does NOT enqueue a second delivery cycle for the same row.
 * - To intentionally re-notify, callers must create a new row identity
 *   (for example: new dedupeKey or no dedupeKey).
 *
 * Important:
 * - DB is the source of truth.
 * - Delivery dispatch is enqueued only for newly created inbox rows.
 */
export async function createProNotification(
  args: CreateProNotificationArgs,
): Promise<ProNotificationCreateResult> {
  return withProNotificationTx(args.tx, async (tx) => {
    const normalized = normalizeCreateArgs(args)

    if (!normalized.dedupeKey) {
      return createAndDispatchProNotification({
        normalizedForCreate: { ...normalized, dedupeKey: null },
        tx,
      })
    }

    const updated = await tx.notification.updateMany({
      where: {
        professionalId: normalized.professionalId,
        dedupeKey: normalized.dedupeKey,
      },
      data: buildUpdateData(normalized),
    })

    if (updated.count > 0) {
      return findNotificationIdByDedupe({
        professionalId: normalized.professionalId,
        dedupeKey: normalized.dedupeKey,
        tx,
      })
    }

    try {
      return await createAndDispatchProNotification({
        normalizedForCreate: normalized,
        tx,
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error
      }

      await tx.notification.updateMany({
        where: {
          professionalId: normalized.professionalId,
          dedupeKey: normalized.dedupeKey,
        },
        data: buildUpdateData(normalized),
      })

      return findNotificationIdByDedupe({
        professionalId: normalized.professionalId,
        dedupeKey: normalized.dedupeKey,
        tx,
      })
    }
  })
}