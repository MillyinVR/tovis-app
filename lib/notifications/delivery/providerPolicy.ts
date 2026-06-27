import {
  NotificationChannel,
  NotificationProvider,
  Prisma,
} from '@prisma/client'

import { requireDefined } from '@/lib/guards'

import { type RenderedNotificationContent } from './renderNotificationContent'
import {
  type DeliveryProviderBinding,
  type ProviderSendRequest,
  assertProviderMatchesRenderedContent,
} from './providerTypes'


export const DELIVERY_RETRY_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
] as const

export function getRetryDelayMs(nextAttemptCount: number): number {
  const index = Math.max(0, nextAttemptCount - 1)
  return requireDefined(
    DELIVERY_RETRY_BACKOFF_MS[
      Math.min(index, DELIVERY_RETRY_BACKOFF_MS.length - 1)
    ],
    'delivery retry backoff delay',
  )
}

const IN_APP_BINDING: DeliveryProviderBinding = {
  channel: NotificationChannel.IN_APP,
  provider: NotificationProvider.INTERNAL_REALTIME,
  maxAttempts: 3,
}

const SMS_BINDING: DeliveryProviderBinding = {
  channel: NotificationChannel.SMS,
  provider: NotificationProvider.TWILIO,
  maxAttempts: 5,
}

const EMAIL_BINDING: DeliveryProviderBinding = {
  channel: NotificationChannel.EMAIL,
  provider: NotificationProvider.POSTMARK,
  maxAttempts: 6,
}

// PUSH is the one channel whose provider is NOT fixed by the channel: a delivery
// row routes via APNS (iOS) or FCM (Android) depending on the target device. The
// `provider` here is only a placeholder so the channel→binding map stays total;
// the real provider is set PER ROW at enqueue (from the device platform) and read
// back from the row at send time. Only `maxAttempts` is authoritative here.
const PUSH_BINDING: DeliveryProviderBinding = {
  channel: NotificationChannel.PUSH,
  provider: NotificationProvider.APNS,
  maxAttempts: 4,
}

export const DELIVERY_PROVIDER_BINDINGS: Record<
  NotificationChannel,
  DeliveryProviderBinding
> = {
  [NotificationChannel.IN_APP]: IN_APP_BINDING,
  [NotificationChannel.SMS]: SMS_BINDING,
  [NotificationChannel.EMAIL]: EMAIL_BINDING,
  [NotificationChannel.PUSH]: PUSH_BINDING,
}

export const DELIVERY_PROVIDER_BINDING_LIST: readonly DeliveryProviderBinding[] = [
  IN_APP_BINDING,
  SMS_BINDING,
  EMAIL_BINDING,
  PUSH_BINDING,
]


function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`providerPolicy: missing ${fieldName}`)
  }
  return normalized
}

function normalizeAttemptCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('providerPolicy: invalid attemptCount')
  }
  return value
}

function buildDeliveryIdempotencyKey(args: {
  deliveryId: string
  attemptCount: number
}): string {
  return `delivery:${args.deliveryId}:attempt:${args.attemptCount + 1}`
}

export function getDeliveryProviderBinding(
  channel: NotificationChannel,
): DeliveryProviderBinding {
  return DELIVERY_PROVIDER_BINDINGS[channel]
}

export function getProviderForChannel(
  channel: NotificationChannel,
): NotificationProvider {
  return getDeliveryProviderBinding(channel).provider
}

export function getMaxAttemptsForChannel(
  channel: NotificationChannel,
): number {
  return getDeliveryProviderBinding(channel).maxAttempts
}

export function isProviderAllowedForChannel(args: {
  channel: NotificationChannel
  provider: NotificationProvider
}): boolean {
  return getProviderForChannel(args.channel) === args.provider
}

function resolvePushProvider(
  provider: NotificationProvider | null | undefined,
): typeof NotificationProvider.APNS | typeof NotificationProvider.FCM {
  // PUSH provider is per-device, so it must be supplied from the delivery row.
  if (
    provider !== NotificationProvider.APNS &&
    provider !== NotificationProvider.FCM
  ) {
    throw new Error(
      'providerPolicy: PUSH delivery requires an APNS or FCM provider from the delivery row',
    )
  }

  return provider
}

export function buildProviderSendRequest(args: {
  deliveryId: string
  dispatchId: string
  destination: string
  attemptCount: number
  content: RenderedNotificationContent
  /**
   * The delivery row's persisted provider. Required for PUSH (APNS|FCM is chosen
   * per device, not by channel); ignored for channels whose provider is fixed by
   * the channel binding.
   */
  provider?: NotificationProvider | null
  metadata?: Prisma.InputJsonValue | null
}): ProviderSendRequest {
  const deliveryId = normalizeRequiredString(args.deliveryId, 'deliveryId')
  const dispatchId = normalizeRequiredString(args.dispatchId, 'dispatchId')
  const destination = normalizeRequiredString(args.destination, 'destination')
  const attemptCount = normalizeAttemptCount(args.attemptCount)

  const binding = getDeliveryProviderBinding(args.content.channel)

  // PUSH's provider is per-device, so resolve it from the row; every other channel
  // uses its fixed channel→provider binding.
  const provider =
    args.content.channel === NotificationChannel.PUSH
      ? resolvePushProvider(args.provider)
      : binding.provider

  assertProviderMatchesRenderedContent({
    provider,
    channel: binding.channel,
    content: args.content,
  })

  const base = {
    deliveryId,
    dispatchId,
    destination,
    attemptCount,
    maxAttempts: binding.maxAttempts,
    idempotencyKey: buildDeliveryIdempotencyKey({
      deliveryId,
      attemptCount,
    }),
    metadata: args.metadata ?? null,
  }

  if (args.content.channel === NotificationChannel.IN_APP) {
    return {
      ...base,
      provider: NotificationProvider.INTERNAL_REALTIME,
      channel: NotificationChannel.IN_APP,
      content: args.content,
    }
  }

  if (args.content.channel === NotificationChannel.SMS) {
    return {
      ...base,
      provider: NotificationProvider.TWILIO,
      channel: NotificationChannel.SMS,
      content: args.content,
    }
  }

  if (args.content.channel === NotificationChannel.PUSH) {
    return {
      ...base,
      provider: resolvePushProvider(args.provider),
      channel: NotificationChannel.PUSH,
      content: args.content,
    }
  }

  return {
    ...base,
    provider: NotificationProvider.POSTMARK,
    channel: NotificationChannel.EMAIL,
    content: args.content,
  }
}