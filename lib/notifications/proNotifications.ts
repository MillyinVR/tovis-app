import { prisma } from '@/lib/prisma'
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

function normRequiredString(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.slice(0, max)
}

function normDefaultString(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return s.slice(0, max)
}

function normNullableString(value: unknown, max: number): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  const clipped = s.slice(0, max)
  return clipped.length > 0 ? clipped : null
}

/**
 * Only allow internal app paths.
 * This prevents accidentally storing external or protocol-relative links
 * in notification href values.
 */
function normInternalHref(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim().slice(0, max) : ''
  if (!s) return ''
  if (!s.startsWith('/')) return ''
  if (s.startsWith('//')) return ''
  return s
}

function normalizeJsonField(value: Prisma.InputJsonValue | null | undefined) {
  if (value === undefined) return undefined
  return value === null ? Prisma.JsonNull : value
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
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
): Prisma.NotificationUncheckedCreateInput {
  const data = normalizeJsonField(normalized.data)

  return {
    professionalId: normalized.professionalId,
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

async function enqueueProNotificationDispatch(args: {
  notificationId: string
  normalized: NormalizedCreateArgs
  tx?: Prisma.TransactionClient
}): Promise<void> {
  const { professional, preference } = await getProfessionalDispatchRecipient({
    professionalId: args.normalized.professionalId,
    eventKey: args.normalized.eventKey,
    tx: args.tx,
  })

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
 * Idempotent pro notification creation.
 *
 * Contract:
 * - If dedupeKey is absent, always creates a new row.
 * - If dedupeKey is present, behaves as an idempotent upsert keyed by
 *   (professionalId, dedupeKey) and resets unread state.
 *
 * Important:
 * - DB is the source of truth.
 * - No mock-only compatibility branches are preserved here.
 * - Delivery dispatch is enqueued after the inbox row is resolved.
 */
export async function createProNotification(
  args: CreateProNotificationArgs,
): Promise<ProNotificationCreateResult> {
  const db = getDb(args.tx)
  const normalized = normalizeCreateArgs(args)

  if (!normalized.dedupeKey) {
    const created = await db.notification.create({
      data: buildCreateData({
        ...normalized,
        dedupeKey: null,
      }),
      select: notificationIdSelect,
    })

    await enqueueProNotificationDispatch({
      notificationId: created.id,
      normalized,
      tx: args.tx,
    })

    return created
  }

  const updated = await db.notification.updateMany({
    where: {
      professionalId: normalized.professionalId,
      dedupeKey: normalized.dedupeKey,
    },
    data: buildUpdateData(normalized),
  })

  if (updated.count > 0) {
    const found = await findNotificationIdByDedupe({
      professionalId: normalized.professionalId,
      dedupeKey: normalized.dedupeKey,
      tx: args.tx,
    })

    await enqueueProNotificationDispatch({
      notificationId: found.id,
      normalized,
      tx: args.tx,
    })

    return found
  }

  try {
    const created = await db.notification.create({
      data: buildCreateData(normalized),
      select: notificationIdSelect,
    })

    await enqueueProNotificationDispatch({
      notificationId: created.id,
      normalized,
      tx: args.tx,
    })

    return created
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    await db.notification.updateMany({
      where: {
        professionalId: normalized.professionalId,
        dedupeKey: normalized.dedupeKey,
      },
      data: buildUpdateData(normalized),
    })

    const found = await findNotificationIdByDedupe({
      professionalId: normalized.professionalId,
      dedupeKey: normalized.dedupeKey,
      tx: args.tx,
    })

    await enqueueProNotificationDispatch({
      notificationId: found.id,
      normalized,
      tx: args.tx,
    })

    return found
  }
}