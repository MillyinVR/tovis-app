import {
  NotificationChannel,
  NotificationProvider,
  Prisma,
} from '@prisma/client'

import { type RenderedNotificationContent } from './renderNotificationContent'
import {
  type DeliveryProviderBinding,
  type ProviderSendRequest,
  assertProviderMatchesRenderedContent,
} from './providerTypes'

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

export const DELIVERY_PROVIDER_BINDINGS: Record<
  NotificationChannel,
  DeliveryProviderBinding
> = {
  [NotificationChannel.IN_APP]: IN_APP_BINDING,
  [NotificationChannel.SMS]: SMS_BINDING,
  [NotificationChannel.EMAIL]: EMAIL_BINDING,
}

export const DELIVERY_PROVIDER_BINDING_LIST: readonly DeliveryProviderBinding[] = [
  IN_APP_BINDING,
  SMS_BINDING,
  EMAIL_BINDING,
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

export function buildProviderSendRequest(args: {
  deliveryId: string
  dispatchId: string
  destination: string
  attemptCount: number
  content: RenderedNotificationContent
  metadata?: Prisma.InputJsonValue | null
}): ProviderSendRequest {
  const deliveryId = normalizeRequiredString(args.deliveryId, 'deliveryId')
  const dispatchId = normalizeRequiredString(args.dispatchId, 'dispatchId')
  const destination = normalizeRequiredString(args.destination, 'destination')
  const attemptCount = normalizeAttemptCount(args.attemptCount)

  const binding = getDeliveryProviderBinding(args.content.channel)

  assertProviderMatchesRenderedContent({
    provider: binding.provider,
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

  return {
    ...base,
    provider: NotificationProvider.POSTMARK,
    channel: NotificationChannel.EMAIL,
    content: args.content,
  }
}