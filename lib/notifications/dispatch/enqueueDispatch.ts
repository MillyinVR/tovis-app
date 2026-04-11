import { prisma } from '@/lib/prisma'
import { pickTimeZoneOrNull } from '@/lib/timeZone'
import {
  NotificationChannel,
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  NotificationPriority,
  NotificationRecipientKind,
  Prisma,
  type NotificationEventKey,
} from '@prisma/client'

import {
  type ChannelEvaluation,
  type ChannelSuppressionReason,
  type NotificationPreferenceLike,
  getRecipientChannelCapabilities,
  resolveChannelPolicy,
} from '../channelPolicy'
import {
  getMaxAttemptsForChannel,
  getProviderForChannel,
} from '../delivery/providerPolicy'
import { getNotificationEventDefinition } from '../eventKeys'

const RECIPIENT_KIND = {
  PRO: 'PRO',
  CLIENT: 'CLIENT',
} satisfies Record<'PRO' | 'CLIENT', NotificationRecipientKind>

const MAX_ID = 64
const MAX_SOURCE_KEY = 256
const MAX_TITLE = 160
const MAX_BODY = 4000
const MAX_HREF = 2048
const MAX_PHONE = 32
const MAX_EMAIL = 320
const MAX_TIME_ZONE = 64

const DEFAULT_TEMPLATE_VERSION = 1

const enqueueDispatchSelect = {
  id: true,
  sourceKey: true,
  eventKey: true,
  recipientKind: true,
  priority: true,
  userId: true,
  professionalId: true,
  clientId: true,
  recipientInAppTargetId: true,
  recipientPhone: true,
  recipientEmail: true,
  recipientTimeZone: true,
  notificationId: true,
  clientNotificationId: true,
  title: true,
  body: true,
  href: true,
  scheduledFor: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  deliveries: {
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      channel: true,
      provider: true,
      status: true,
      destination: true,
      templateKey: true,
      templateVersion: true,
      attemptCount: true,
      maxAttempts: true,
      nextAttemptAt: true,
      lastAttemptAt: true,
      claimedAt: true,
      leaseExpiresAt: true,
      providerMessageId: true,
      providerStatus: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      sentAt: true,
      deliveredAt: true,
      failedAt: true,
      suppressedAt: true,
      cancelledAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.NotificationDispatchSelect

export type EnqueuedDispatchRecord = Prisma.NotificationDispatchGetPayload<{
  select: typeof enqueueDispatchSelect
}>

type DispatchDbClient = Prisma.TransactionClient | typeof prisma

type EnqueueDispatchRecipientBase = {
  userId?: string | null
  inAppTargetId?: string | null
  phone?: string | null
  phoneVerifiedAt?: Date | null
  email?: string | null
  emailVerifiedAt?: Date | null
  timeZone?: string | null
  preference?: NotificationPreferenceLike | null
}

export type EnqueueProDispatchRecipient = EnqueueDispatchRecipientBase & {
  kind: typeof RECIPIENT_KIND.PRO
  professionalId: string
}

export type EnqueueClientDispatchRecipient = EnqueueDispatchRecipientBase & {
  kind: typeof RECIPIENT_KIND.CLIENT
  clientId: string
}

export type EnqueueDispatchRecipient =
  | EnqueueProDispatchRecipient
  | EnqueueClientDispatchRecipient

export type EnqueueDispatchArgs = {
  key: NotificationEventKey
  sourceKey: string
  recipient: EnqueueDispatchRecipient

  title: string
  body?: string | null
  href?: string | null
  payload?: Prisma.InputJsonValue | null

  priority?: NotificationPriority | null
  scheduledFor?: Date | null

  notificationId?: string | null
  clientNotificationId?: string | null

  /**
   * Optional narrowing only.
   * This can reduce channels but never expand beyond the event definition.
   */
  requestedChannels?: readonly NotificationChannel[] | null

  /**
   * Optional transaction client so callers can enqueue dispatch rows
   * inside an existing prisma.$transaction(...) block.
   */
  tx?: Prisma.TransactionClient
}

export type EnqueueDispatchResult = {
  created: boolean
  dispatch: EnqueuedDispatchRecord
  selectedChannels: NotificationChannel[]
  evaluations: ChannelEvaluation[]
}

type NormalizedEnqueueDispatchArgs = {
  key: NotificationEventKey
  sourceKey: string
  recipientKind: NotificationRecipientKind
  userId: string | null
  professionalId: string | null
  clientId: string | null
  inAppTargetId: string | null
  phone: string | null
  phoneVerifiedAt: Date | null
  email: string | null
  emailVerifiedAt: Date | null
  timeZone: string | null
  preference: NotificationPreferenceLike | null

  title: string
  body: string
  href: string
  payload: Prisma.InputJsonValue | Prisma.NullTypes.JsonNull | undefined

  priority: NotificationPriority
  scheduledFor: Date

  notificationId: string | null
  clientNotificationId: string | null

  requestedChannels: readonly NotificationChannel[] | null
}

type DeliveryCreateRow = {
  channel: NotificationChannel
  status: NotificationDeliveryStatus
  destination: string | null
  templateKey: string
  templateVersion: number
  maxAttempts: number
  nextAttemptAt: Date
  suppressedAt: Date | null
  events: Prisma.NotificationDeliveryEventCreateWithoutDeliveryInput[]
}

function getDb(tx?: Prisma.TransactionClient): DispatchDbClient {
  return tx ?? prisma
}

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

function normalizeDate(value: unknown, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`enqueueDispatch: invalid ${fieldName}`)
  }

  return value
}

function normalizeRecipientTimeZone(
  value: string | null | undefined,
): string | null {
  const normalized = pickTimeZoneOrNull(value)
  if (!normalized) return null

  return normalized.length <= MAX_TIME_ZONE ? normalized : null
}

function isProDispatchRecipient(
  recipient: EnqueueDispatchRecipient,
): recipient is EnqueueProDispatchRecipient {
  return recipient.kind === RECIPIENT_KIND.PRO
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

function resolveInAppTargetId(
  recipient: EnqueueDispatchRecipient,
): string | null {
  const explicitTarget = normNullableString(recipient.inAppTargetId, MAX_ID)
  if (explicitTarget) return explicitTarget

  if (isProDispatchRecipient(recipient)) {
    return normNullableString(recipient.professionalId, MAX_ID)
  }

  return normNullableString(recipient.clientId, MAX_ID)
}

function getDestinationForChannel(args: {
  channel: NotificationChannel
  capabilities: ReturnType<typeof getRecipientChannelCapabilities>
  inAppTargetId: string | null
  phone: string | null
  email: string | null
}): string | null {
  if (args.channel === NotificationChannel.IN_APP) {
    return args.capabilities.hasInAppTarget ? args.inAppTargetId : null
  }

  if (args.channel === NotificationChannel.SMS) {
    return args.capabilities.hasSmsDestination ? args.phone : null
  }

  return args.capabilities.hasEmailDestination ? args.email : null
}

function buildSuppressedEventPayload(reason: string) {
  return {
    source: 'enqueueDispatch',
    suppressionReason: reason,
  } satisfies Prisma.InputJsonObject
}

function buildDeliveryEvents(args: {
  status: NotificationDeliveryStatus
  suppressionReason: string | null
}): Prisma.NotificationDeliveryEventCreateWithoutDeliveryInput[] {
  const createdEvent: Prisma.NotificationDeliveryEventCreateWithoutDeliveryInput =
    {
      type: NotificationDeliveryEventType.CREATED,
      toStatus: args.status,
      message:
        args.status === NotificationDeliveryStatus.SUPPRESSED
          ? 'Delivery row created in suppressed state.'
          : 'Delivery row enqueued.',
    }

  if (
    args.status !== NotificationDeliveryStatus.SUPPRESSED ||
    !args.suppressionReason
  ) {
    return [createdEvent]
  }

  return [
    createdEvent,
    {
      type: NotificationDeliveryEventType.SUPPRESSED,
      toStatus: NotificationDeliveryStatus.SUPPRESSED,
      message: `Delivery suppressed at enqueue: ${args.suppressionReason}`,
      payload: buildSuppressedEventPayload(args.suppressionReason),
    },
  ]
}

function inferSuppressionReasonFromPersistedDelivery(args: {
  channel: NotificationChannel
  destination: string | null
}): ChannelSuppressionReason | null {
  if (args.destination != null) {
    return null
  }

  if (args.channel === NotificationChannel.IN_APP) {
    return 'MISSING_IN_APP_TARGET'
  }

  if (args.channel === NotificationChannel.SMS) {
    return 'MISSING_SMS_DESTINATION'
  }

  return 'MISSING_EMAIL_DESTINATION'
}

function derivePolicyFromPersistedDispatch(
  dispatch: EnqueuedDispatchRecord,
): Pick<EnqueueDispatchResult, 'selectedChannels' | 'evaluations'> {
  const evaluations: ChannelEvaluation[] = dispatch.deliveries.map((delivery) => {
    const enabled = delivery.status !== NotificationDeliveryStatus.SUPPRESSED

    return {
      channel: delivery.channel,
      enabled,
      reason: enabled
        ? null
        : inferSuppressionReasonFromPersistedDelivery({
            channel: delivery.channel,
            destination: delivery.destination,
          }),
    }
  })

  return {
    selectedChannels: evaluations
      .filter((evaluation) => evaluation.enabled)
      .map((evaluation) => evaluation.channel),
    evaluations,
  }
}

function buildCapabilities(args: {
  recipientKind: NotificationRecipientKind
  inAppTargetId: string | null
  phone: string | null
  phoneVerifiedAt: Date | null
  email: string | null
  emailVerifiedAt: Date | null
}) {
  return getRecipientChannelCapabilities({
    recipientKind: args.recipientKind,
    inAppTargetId: args.inAppTargetId,
    phone: args.phone,
    phoneVerifiedAt: args.phoneVerifiedAt,
    email: args.email,
    emailVerifiedAt: args.emailVerifiedAt,
  })
}

function buildDeliveryRows(args: {
  normalized: NormalizedEnqueueDispatchArgs
  evaluations: ChannelEvaluation[]
  capabilities: ReturnType<typeof getRecipientChannelCapabilities>
}): DeliveryCreateRow[] {
  const eventDefinition = getNotificationEventDefinition(args.normalized.key)
  const templateKey = eventDefinition.templateKey

  return args.evaluations.map((evaluation) => {
    const destination = getDestinationForChannel({
      channel: evaluation.channel,
      capabilities: args.capabilities,
      inAppTargetId: args.normalized.inAppTargetId,
      phone: args.normalized.phone,
      email: args.normalized.email,
    })

    const status = evaluation.enabled
      ? NotificationDeliveryStatus.PENDING
      : NotificationDeliveryStatus.SUPPRESSED

    const suppressedAt =
      status === NotificationDeliveryStatus.SUPPRESSED ? new Date() : null

    return {
      channel: evaluation.channel,
      status,
      destination,
      templateKey,
      templateVersion: DEFAULT_TEMPLATE_VERSION,
      maxAttempts: getMaxAttemptsForChannel(evaluation.channel),
      nextAttemptAt: args.normalized.scheduledFor,
      suppressedAt,
      events: buildDeliveryEvents({
        status,
        suppressionReason: evaluation.reason,
      }),
    }
  })
}

function buildDispatchCreateData(args: {
  normalized: NormalizedEnqueueDispatchArgs
  deliveryRows: DeliveryCreateRow[]
}): Prisma.NotificationDispatchCreateInput {
  const { normalized, deliveryRows } = args

  return {
    sourceKey: normalized.sourceKey,
    eventKey: normalized.key,
    recipientKind: normalized.recipientKind,
    priority: normalized.priority,

    recipientInAppTargetId: normalized.inAppTargetId,
    recipientPhone: normalized.phone,
    recipientEmail: normalized.email,
    recipientTimeZone: normalized.timeZone,

    title: normalized.title,
    body: normalized.body,
    href: normalized.href,
    scheduledFor: normalized.scheduledFor,

    ...(normalized.payload !== undefined ? { payload: normalized.payload } : {}),

    ...(normalized.userId
      ? {
          user: {
            connect: { id: normalized.userId },
          },
        }
      : {}),

    ...(normalized.professionalId
      ? {
          professional: {
            connect: { id: normalized.professionalId },
          },
        }
      : {}),

    ...(normalized.clientId
      ? {
          client: {
            connect: { id: normalized.clientId },
          },
        }
      : {}),

    ...(normalized.notificationId
      ? {
          notification: {
            connect: { id: normalized.notificationId },
          },
        }
      : {}),

    ...(normalized.clientNotificationId
      ? {
          clientNotification: {
            connect: { id: normalized.clientNotificationId },
          },
        }
      : {}),

    deliveries: {
      create: deliveryRows.map((row) => ({
        channel: row.channel,
        provider: getProviderForChannel(row.channel),
        status: row.status,
        destination: row.destination,
        templateKey: row.templateKey,
        templateVersion: row.templateVersion,
        attemptCount: 0,
        maxAttempts: row.maxAttempts,
        nextAttemptAt: row.nextAttemptAt,
        ...(row.suppressedAt ? { suppressedAt: row.suppressedAt } : {}),
        events: {
          create: row.events,
        },
      })),
    },
  }
}

function normalizeArgs(args: EnqueueDispatchArgs): NormalizedEnqueueDispatchArgs {
  const eventDefinition = getNotificationEventDefinition(args.key)
  const sourceKey = normRequiredString(args.sourceKey, MAX_SOURCE_KEY)
  const title = normRequiredString(args.title, MAX_TITLE)

  if (!sourceKey) {
    throw new Error('enqueueDispatch: missing sourceKey')
  }

  if (!title) {
    throw new Error('enqueueDispatch: missing title')
  }

  const notificationId = normNullableString(args.notificationId, MAX_ID)
  const clientNotificationId = normNullableString(
    args.clientNotificationId,
    MAX_ID,
  )

  if (notificationId && clientNotificationId) {
    throw new Error(
      'enqueueDispatch: notificationId and clientNotificationId are mutually exclusive',
    )
  }

  const userId = normNullableString(args.recipient.userId, MAX_ID)
  const inAppTargetId = resolveInAppTargetId(args.recipient)
  const phone = normNullableString(args.recipient.phone, MAX_PHONE)
  const email = normNullableString(args.recipient.email, MAX_EMAIL)
  const timeZone = normalizeRecipientTimeZone(args.recipient.timeZone)

  if (
    args.recipient.phoneVerifiedAt != null &&
    (!(args.recipient.phoneVerifiedAt instanceof Date) ||
      Number.isNaN(args.recipient.phoneVerifiedAt.getTime()))
  ) {
    throw new Error('enqueueDispatch: invalid recipient.phoneVerifiedAt')
  }

  if (
    args.recipient.emailVerifiedAt != null &&
    (!(args.recipient.emailVerifiedAt instanceof Date) ||
      Number.isNaN(args.recipient.emailVerifiedAt.getTime()))
  ) {
    throw new Error('enqueueDispatch: invalid recipient.emailVerifiedAt')
  }

  if (isProDispatchRecipient(args.recipient)) {
    const professionalId = normRequiredString(
      args.recipient.professionalId,
      MAX_ID,
    )

    if (!professionalId) {
      throw new Error('enqueueDispatch: missing recipient.professionalId')
    }

    return {
      key: args.key,
      sourceKey,
      recipientKind: RECIPIENT_KIND.PRO,
      userId,
      professionalId,
      clientId: null,
      inAppTargetId,
      phone,
      phoneVerifiedAt: args.recipient.phoneVerifiedAt ?? null,
      email,
      emailVerifiedAt: args.recipient.emailVerifiedAt ?? null,
      timeZone,
      preference: args.recipient.preference ?? null,
      title,
      body: normDefaultString(args.body, MAX_BODY),
      href: normInternalHref(args.href, MAX_HREF),
      payload: normalizeJsonField(args.payload),
      priority: args.priority ?? eventDefinition.defaultPriority,
      scheduledFor: normalizeDate(
        args.scheduledFor ?? new Date(),
        'scheduledFor',
      ),
      notificationId,
      clientNotificationId,
      requestedChannels: args.requestedChannels ?? null,
    }
  }

  const clientId = normRequiredString(args.recipient.clientId, MAX_ID)

  if (!clientId) {
    throw new Error('enqueueDispatch: missing recipient.clientId')
  }

  return {
    key: args.key,
    sourceKey,
    recipientKind: RECIPIENT_KIND.CLIENT,
    userId,
    professionalId: null,
    clientId,
    inAppTargetId,
    phone,
    phoneVerifiedAt: args.recipient.phoneVerifiedAt ?? null,
    email,
    emailVerifiedAt: args.recipient.emailVerifiedAt ?? null,
    timeZone,
    preference: args.recipient.preference ?? null,
    title,
    body: normDefaultString(args.body, MAX_BODY),
    href: normInternalHref(args.href, MAX_HREF),
    payload: normalizeJsonField(args.payload),
    priority: args.priority ?? eventDefinition.defaultPriority,
    scheduledFor: normalizeDate(
      args.scheduledFor ?? new Date(),
      'scheduledFor',
    ),
    notificationId,
    clientNotificationId,
    requestedChannels: args.requestedChannels ?? null,
  }
}

async function findDispatchBySourceKey(args: {
  sourceKey: string
  tx?: Prisma.TransactionClient
}): Promise<EnqueuedDispatchRecord | null> {
  const db = getDb(args.tx)

  return db.notificationDispatch.findUnique({
    where: {
      sourceKey: args.sourceKey,
    },
    select: enqueueDispatchSelect,
  })
}

async function findDispatchBySourceKeyOrThrow(args: {
  sourceKey: string
  tx?: Prisma.TransactionClient
}): Promise<EnqueuedDispatchRecord> {
  const found = await findDispatchBySourceKey(args)

  if (!found) {
    throw new Error('enqueueDispatch: dispatch not found after create/update')
  }

  return found
}

/**
 * Creates a durable NotificationDispatch row plus one NotificationDelivery row
 * per evaluated channel.
 *
 * Idempotency contract:
 * - sourceKey is the stable unique key
 * - if the row already exists, this returns the existing dispatch unchanged
 * - on idempotent returns, selectedChannels/evaluations are derived from the
 *   persisted delivery rows, not recomputed from possibly newer caller input
 *
 * Important:
 * - DB is the source of truth
 * - quiet hours are intentionally NOT enforced here
 * - worker/runtime delivery code can apply deferral rules later
 * - recipientTimeZone is stored only when it is a valid IANA timezone
 */
export async function enqueueDispatch(
  args: EnqueueDispatchArgs,
): Promise<EnqueueDispatchResult> {
  const db = getDb(args.tx)
  const normalized = normalizeArgs(args)

  const capabilities = buildCapabilities({
    recipientKind: normalized.recipientKind,
    inAppTargetId: normalized.inAppTargetId,
    phone: normalized.phone,
    phoneVerifiedAt: normalized.phoneVerifiedAt,
    email: normalized.email,
    emailVerifiedAt: normalized.emailVerifiedAt,
  })

  const policy = resolveChannelPolicy({
    key: normalized.key,
    recipientKind: normalized.recipientKind,
    capabilities,
    preference: normalized.preference,
    requestedChannels: normalized.requestedChannels,

    // Quiet hours are evaluated later at delivery time, not enqueue time.
    recipientLocalMinutes: null,
  })

  const deliveryRows = buildDeliveryRows({
    normalized,
    evaluations: policy.evaluations,
    capabilities,
  })

  const existing = await findDispatchBySourceKey({
    sourceKey: normalized.sourceKey,
    tx: args.tx,
  })

  if (existing) {
    const persistedPolicy = derivePolicyFromPersistedDispatch(existing)

    return {
      created: false,
      dispatch: existing,
      selectedChannels: persistedPolicy.selectedChannels,
      evaluations: persistedPolicy.evaluations,
    }
  }

  try {
    const created = await db.notificationDispatch.create({
      data: buildDispatchCreateData({
        normalized,
        deliveryRows,
      }),
      select: enqueueDispatchSelect,
    })

    return {
      created: true,
      dispatch: created,
      selectedChannels: policy.selectedChannels,
      evaluations: policy.evaluations,
    }
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    const found = await findDispatchBySourceKeyOrThrow({
      sourceKey: normalized.sourceKey,
      tx: args.tx,
    })
    const persistedPolicy = derivePolicyFromPersistedDispatch(found)

    return {
      created: false,
      dispatch: found,
      selectedChannels: persistedPolicy.selectedChannels,
      evaluations: persistedPolicy.evaluations,
    }
  }
}