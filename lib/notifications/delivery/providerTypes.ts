import {
  NotificationChannel,
  NotificationProvider,
  Prisma,
} from '@prisma/client'

import {
  type RenderedEmailNotificationContent,
  type RenderedInAppNotificationContent,
  type RenderedNotificationContent,
  type RenderedSmsNotificationContent,
} from './renderNotificationContent'

export type DeliveryProviderBinding = {
  channel: NotificationChannel
  provider: NotificationProvider
  maxAttempts: number
}

type ProviderSendRequestBase = {
  deliveryId: string
  dispatchId: string
  destination: string
  attemptCount: number
  maxAttempts: number
  idempotencyKey: string
  metadata?: Prisma.InputJsonValue | null
}

export type InAppProviderSendRequest = ProviderSendRequestBase & {
  provider: typeof NotificationProvider.INTERNAL_REALTIME
  channel: typeof NotificationChannel.IN_APP
  content: RenderedInAppNotificationContent
}

export type SmsProviderSendRequest = ProviderSendRequestBase & {
  provider: typeof NotificationProvider.TWILIO
  channel: typeof NotificationChannel.SMS
  content: RenderedSmsNotificationContent
}

export type EmailProviderSendRequest = ProviderSendRequestBase & {
  provider: typeof NotificationProvider.POSTMARK
  channel: typeof NotificationChannel.EMAIL
  content: RenderedEmailNotificationContent
}

export type ProviderSendRequest =
  | InAppProviderSendRequest
  | SmsProviderSendRequest
  | EmailProviderSendRequest

export type ProviderSuccessResult = {
  ok: true
  providerMessageId: string | null
  providerStatus: string | null
  responseMeta?: Prisma.InputJsonValue | null
}

export type ProviderFailureResult = {
  ok: false
  retryable: boolean
  code: string
  message: string
  providerStatus: string | null
  responseMeta?: Prisma.InputJsonValue | null
}

export type ProviderSendResult =
  | ProviderSuccessResult
  | ProviderFailureResult

export interface NotificationDeliveryProvider<
  TRequest extends ProviderSendRequest = ProviderSendRequest,
> {
  readonly provider: TRequest['provider']
  readonly channel: TRequest['channel']
  send(request: TRequest): Promise<ProviderSendResult>
}

export function isInAppProviderSendRequest(
  request: ProviderSendRequest,
): request is InAppProviderSendRequest {
  return (
    request.provider === NotificationProvider.INTERNAL_REALTIME &&
    request.channel === NotificationChannel.IN_APP
  )
}

export function isSmsProviderSendRequest(
  request: ProviderSendRequest,
): request is SmsProviderSendRequest {
  return (
    request.provider === NotificationProvider.TWILIO &&
    request.channel === NotificationChannel.SMS
  )
}

export function isEmailProviderSendRequest(
  request: ProviderSendRequest,
): request is EmailProviderSendRequest {
  return (
    request.provider === NotificationProvider.POSTMARK &&
    request.channel === NotificationChannel.EMAIL
  )
}

export function assertProviderMatchesRenderedContent(args: {
  provider: NotificationProvider
  channel: NotificationChannel
  content: RenderedNotificationContent
}): void {
  if (args.channel !== args.content.channel) {
    throw new Error(
      'providerTypes: rendered content channel does not match requested channel',
    )
  }

  if (
    args.provider === NotificationProvider.INTERNAL_REALTIME &&
    args.channel !== NotificationChannel.IN_APP
  ) {
    throw new Error('providerTypes: INTERNAL_REALTIME must use IN_APP channel')
  }

  if (
    args.provider === NotificationProvider.TWILIO &&
    args.channel !== NotificationChannel.SMS
  ) {
    throw new Error('providerTypes: TWILIO must use SMS channel')
  }

  if (
    args.provider === NotificationProvider.POSTMARK &&
    args.channel !== NotificationChannel.EMAIL
  ) {
    throw new Error('providerTypes: POSTMARK must use EMAIL channel')
  }
}