// lib/notifications/providerStatus.ts

import {
  NotificationDeliveryEventType,
  NotificationDeliveryStatus,
  NotificationProvider,
} from '@prisma/client'

export type ProviderDeliveryWebhookKind =
  | 'STATUS_UPDATE'
  | 'DELIVERED'
  | 'FAILED_FINAL'

export type ProviderSendResultKind =
  | 'PROVIDER_ACCEPTED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL'
  | 'SUPPRESSED'
  | 'CANCELLED'

export type ProviderStatusTransition = {
  nextStatus: NotificationDeliveryStatus
  eventType: NotificationDeliveryEventType
  isTerminal: boolean
  shouldSetSentAt: boolean
  shouldSetDeliveredAt: boolean
  shouldSetFailedAt: boolean
  shouldSetSuppressedAt: boolean
  shouldSetCancelledAt: boolean
}

export type ProviderStatusInput = {
  provider: NotificationProvider
  providerStatus: string | null
  kind?: ProviderDeliveryWebhookKind | null
}

function normalizeProviderStatus(providerStatus: string | null): string {
  return providerStatus?.trim().toLowerCase() ?? ''
}

export function isTerminalNotificationDeliveryStatus(
  status: NotificationDeliveryStatus,
): boolean {
  return (
    status === NotificationDeliveryStatus.DELIVERED ||
    status === NotificationDeliveryStatus.FAILED_FINAL ||
    status === NotificationDeliveryStatus.SUPPRESSED ||
    status === NotificationDeliveryStatus.CANCELLED
  )
}

export function shouldIgnoreProviderWebhookForCurrentStatus(
  currentStatus: NotificationDeliveryStatus,
): boolean {
  return isTerminalNotificationDeliveryStatus(currentStatus)
}

export function mapProviderAcceptedToDeliveryTransition(): ProviderStatusTransition {
  return {
    nextStatus: NotificationDeliveryStatus.SENT,
    eventType: NotificationDeliveryEventType.PROVIDER_ACCEPTED,
    isTerminal: false,
    shouldSetSentAt: true,
    shouldSetDeliveredAt: false,
    shouldSetFailedAt: false,
    shouldSetSuppressedAt: false,
    shouldSetCancelledAt: false,
  }
}

export function mapProviderSendFailureToDeliveryTransition(
  kind: Extract<ProviderSendResultKind, 'FAILED_RETRYABLE' | 'FAILED_FINAL'>,
): ProviderStatusTransition {
  const isFinal = kind === 'FAILED_FINAL'

  return {
    nextStatus: isFinal
      ? NotificationDeliveryStatus.FAILED_FINAL
      : NotificationDeliveryStatus.FAILED_RETRYABLE,
    eventType: isFinal
      ? NotificationDeliveryEventType.FAILED
      : NotificationDeliveryEventType.RETRY_SCHEDULED,
    isTerminal: isFinal,
    shouldSetSentAt: false,
    shouldSetDeliveredAt: false,
    shouldSetFailedAt: isFinal,
    shouldSetSuppressedAt: false,
    shouldSetCancelledAt: false,
  }
}

export function mapProviderSuppressedToDeliveryTransition(): ProviderStatusTransition {
  return {
    nextStatus: NotificationDeliveryStatus.SUPPRESSED,
    eventType: NotificationDeliveryEventType.SUPPRESSED,
    isTerminal: true,
    shouldSetSentAt: false,
    shouldSetDeliveredAt: false,
    shouldSetFailedAt: false,
    shouldSetSuppressedAt: true,
    shouldSetCancelledAt: false,
  }
}

export function mapProviderCancelledToDeliveryTransition(): ProviderStatusTransition {
  return {
    nextStatus: NotificationDeliveryStatus.CANCELLED,
    eventType: NotificationDeliveryEventType.CANCELLED,
    isTerminal: true,
    shouldSetSentAt: false,
    shouldSetDeliveredAt: false,
    shouldSetFailedAt: false,
    shouldSetSuppressedAt: false,
    shouldSetCancelledAt: true,
  }
}

export function mapWebhookKindToDeliveryTransition(
  kind: ProviderDeliveryWebhookKind,
): ProviderStatusTransition {
  if (kind === 'DELIVERED') {
    return {
      nextStatus: NotificationDeliveryStatus.DELIVERED,
      eventType: NotificationDeliveryEventType.DELIVERED,
      isTerminal: true,
      shouldSetSentAt: false,
      shouldSetDeliveredAt: true,
      shouldSetFailedAt: false,
      shouldSetSuppressedAt: false,
      shouldSetCancelledAt: false,
    }
  }

  if (kind === 'FAILED_FINAL') {
    return {
      nextStatus: NotificationDeliveryStatus.FAILED_FINAL,
      eventType: NotificationDeliveryEventType.FAILED,
      isTerminal: true,
      shouldSetSentAt: false,
      shouldSetDeliveredAt: false,
      shouldSetFailedAt: true,
      shouldSetSuppressedAt: false,
      shouldSetCancelledAt: false,
    }
  }

  return {
    nextStatus: NotificationDeliveryStatus.SENT,
    eventType: NotificationDeliveryEventType.WEBHOOK_UPDATE,
    isTerminal: false,
    shouldSetSentAt: false,
    shouldSetDeliveredAt: false,
    shouldSetFailedAt: false,
    shouldSetSuppressedAt: false,
    shouldSetCancelledAt: false,
  }
}

export function mapTwilioProviderStatusToWebhookKind(
  providerStatus: string | null,
): ProviderDeliveryWebhookKind {
  const status = normalizeProviderStatus(providerStatus)

  if (status === 'delivered') {
    return 'DELIVERED'
  }

  if (
    status === 'failed' ||
    status === 'undelivered' ||
    status === 'canceled'
  ) {
    return 'FAILED_FINAL'
  }

  return 'STATUS_UPDATE'
}

export function mapPostmarkProviderStatusToWebhookKind(
  providerStatus: string | null,
): ProviderDeliveryWebhookKind {
  const status = normalizeProviderStatus(providerStatus)

  if (status === 'delivered' || status === 'delivery') {
    return 'DELIVERED'
  }

  if (
    status === 'spam_complaint' ||
    status === 'spamcomplaint' ||
    status === 'bounce' ||
    status.startsWith('bounce:')
  ) {
    return 'FAILED_FINAL'
  }

  return 'STATUS_UPDATE'
}

export function mapProviderStatusToWebhookKind(
  input: ProviderStatusInput,
): ProviderDeliveryWebhookKind {
  if (input.kind) return input.kind

  if (input.provider === NotificationProvider.TWILIO) {
    return mapTwilioProviderStatusToWebhookKind(input.providerStatus)
  }

  if (input.provider === NotificationProvider.POSTMARK) {
    return mapPostmarkProviderStatusToWebhookKind(input.providerStatus)
  }

  return 'STATUS_UPDATE'
}

export function mapProviderWebhookToDeliveryTransition(
  input: ProviderStatusInput,
): ProviderStatusTransition {
  return mapWebhookKindToDeliveryTransition(
    mapProviderStatusToWebhookKind(input),
  )
}

export function isRetryableProviderError(args: {
  provider: NotificationProvider
  errorCode: string | null
  errorMessage?: string | null
}): boolean {
  const code = args.errorCode?.trim()

  if (args.provider === NotificationProvider.TWILIO) {
    if (!code) return true

    // Twilio examples:
    // 30001 queue overflow, 30002 account suspended, 30003 unreachable handset,
    // 30004 blocked, 30005 unknown destination, 30006 landline/unreachable carrier,
    // 30007 carrier violation, 30008 unknown error.
    //
    // Treat transient/platform-ish failures as retryable; recipient/content failures final.
    return code === '30001' || code === '30008'
  }

  if (args.provider === NotificationProvider.POSTMARK) {
    if (!code) return false

    // Postmark bounce TypeCode values can be provider-specific.
    // Keep this conservative: hard bounce / spam complaint should be final upstream
    // via webhook kind. Sender-side API/network exceptions should usually be handled
    // before this helper as FAILED_RETRYABLE.
    return false
  }

  return false
}

export function mapProviderErrorToSendFailureKind(args: {
  provider: NotificationProvider
  errorCode: string | null
  errorMessage?: string | null
}): Extract<ProviderSendResultKind, 'FAILED_RETRYABLE' | 'FAILED_FINAL'> {
  return isRetryableProviderError(args) ? 'FAILED_RETRYABLE' : 'FAILED_FINAL'
}