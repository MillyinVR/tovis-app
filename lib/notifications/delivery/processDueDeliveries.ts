// lib/notifications/delivery/processDueDeliveries.ts

import {
  NotificationChannel,
  NotificationProvider,
} from '@prisma/client'

import {
  getNotificationEventDefinition,
  type NotificationTemplateKey,
} from '../eventKeys'
import {
  claimDeliveries,
  type ClaimDeliveriesArgs,
  type ClaimedNotificationDelivery,
} from './claimDeliveries'
import { completeDeliveryAttempt } from './completeDeliveryAttempt'
import { buildProviderSendRequest } from './providerPolicy'
import { renderNotificationContent } from './renderNotificationContent'
import {
  type EmailProviderSendRequest,
  type InAppProviderSendRequest,
  type NotificationDeliveryProvider,
  type ProviderSendRequest,
  type ProviderSendResult,
  type SmsProviderSendRequest,
} from './providerTypes'

const RETRY_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
] as const

export type ProcessDueDeliveriesArgs = ClaimDeliveriesArgs

export type ProcessedDeliveryOutcome =
  | {
      deliveryId: string
      provider: NotificationProvider
      channel: NotificationChannel
      result: 'SENT'
    }
  | {
      deliveryId: string
      provider: NotificationProvider
      channel: NotificationChannel
      result: 'RETRY_SCHEDULED'
      nextAttemptAt: Date
    }
  | {
      deliveryId: string
      provider: NotificationProvider
      channel: NotificationChannel
      result: 'FAILED_FINAL'
    }
  | {
      deliveryId: string
      provider: NotificationProvider
      channel: NotificationChannel
      result: 'ORCHESTRATION_ERROR'
      message: string
    }

export type ProcessDueDeliveriesResult = {
  claimedCount: number
  processedCount: number
  sentCount: number
  retryScheduledCount: number
  finalFailureCount: number
  orchestrationErrorCount: number
  outcomes: ProcessedDeliveryOutcome[]
}

export type DeliveryProviderRegistry = {
  inApp: NotificationDeliveryProvider<InAppProviderSendRequest>
  sms: NotificationDeliveryProvider<SmsProviderSendRequest>
  email: NotificationDeliveryProvider<EmailProviderSendRequest>
}

function normalizeNow(value: Date | undefined): Date {
  const now = value ?? new Date()

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('processDueDeliveries: invalid now')
  }

  return now
}

function normalizeErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof Error)) {
    return fallback
  }

  const message = error.message.trim()
  return message.length > 0 ? message : fallback
}

function getTemplateKeyForDelivery(
  delivery: ClaimedNotificationDelivery,
): NotificationTemplateKey {
  const expectedTemplateKey = getNotificationEventDefinition(
    delivery.dispatch.eventKey,
  ).templateKey

  if (delivery.templateKey !== expectedTemplateKey) {
    throw new Error(
      `processDueDeliveries: delivery templateKey ${delivery.templateKey} does not match event ${delivery.dispatch.eventKey} (${expectedTemplateKey})`,
    )
  }

  return expectedTemplateKey
}

function getRetryDelayMs(nextAttemptCount: number): number {
  const index = Math.max(0, nextAttemptCount - 1)
  return RETRY_BACKOFF_MS[Math.min(index, RETRY_BACKOFF_MS.length - 1)]
}

function buildNextAttemptAt(args: {
  attemptedAt: Date
  nextAttemptCount: number
}): Date {
  return new Date(
    args.attemptedAt.getTime() + getRetryDelayMs(args.nextAttemptCount),
  )
}

function hasRetryAttemptsRemaining(
  delivery: ClaimedNotificationDelivery,
): boolean {
  return delivery.attemptCount < delivery.maxAttempts - 1
}

function buildProviderRequest(
  delivery: ClaimedNotificationDelivery,
): ProviderSendRequest {
  const content = renderNotificationContent({
    channel: delivery.channel,
    templateKey: getTemplateKeyForDelivery(delivery),
    templateVersion: delivery.templateVersion,
    dispatch: {
      eventKey: delivery.dispatch.eventKey,
      title: delivery.dispatch.title,
      body: delivery.dispatch.body,
      href: delivery.dispatch.href,
      payload: delivery.dispatch.payload,
    },
  })

  const request = buildProviderSendRequest({
    deliveryId: delivery.id,
    dispatchId: delivery.dispatch.id,
    destination: delivery.destination ?? '',
    attemptCount: delivery.attemptCount,
    content,
    metadata: {
      source: 'processDueDeliveries',
      sourceKey: delivery.dispatch.sourceKey,
      eventKey: delivery.dispatch.eventKey,
      channel: delivery.channel,
      provider: delivery.provider,
    },
  })

  if (request.channel !== delivery.channel) {
    throw new Error(
      `processDueDeliveries: provider request channel ${request.channel} does not match delivery channel ${delivery.channel}`,
    )
  }

  if (request.provider !== delivery.provider) {
    throw new Error(
      `processDueDeliveries: provider request provider ${request.provider} does not match delivery provider ${delivery.provider}`,
    )
  }

  return request
}

async function sendWithProvider(args: {
  request: ProviderSendRequest
  providers: DeliveryProviderRegistry
}): Promise<ProviderSendResult> {
  switch (args.request.provider) {
    case NotificationProvider.INTERNAL_REALTIME:
      return args.providers.inApp.send(args.request)

    case NotificationProvider.TWILIO:
      return args.providers.sms.send(args.request)

    case NotificationProvider.POSTMARK:
      return args.providers.email.send(args.request)
  }
}

async function finalizeOrchestrationFailure(args: {
  delivery: ClaimedNotificationDelivery
  leaseToken: string
  attemptedAt: Date
  message: string
}): Promise<string> {
  try {
    await completeDeliveryAttempt({
      kind: 'FINAL_FAILURE',
      deliveryId: args.delivery.id,
      leaseToken: args.leaseToken,
      attemptedAt: args.attemptedAt,
      code: 'DELIVERY_ORCHESTRATION_ERROR',
      message: args.message,
      providerStatus: 'orchestration_error',
      responseMeta: {
        source: 'processDueDeliveries',
        provider: args.delivery.provider,
        channel: args.delivery.channel,
      },
    })

    return args.message
  } catch (finalizeError) {
    const finalizeMessage = normalizeErrorMessage(
      finalizeError,
      'Unknown delivery finalization error.',
    )

    return `${args.message} Finalization also failed: ${finalizeMessage}`
  }
}

async function finalizeSendResult(args: {
  delivery: ClaimedNotificationDelivery
  leaseToken: string
  attemptedAt: Date
  sendResult: ProviderSendResult
}): Promise<ProcessedDeliveryOutcome> {
  if (args.sendResult.ok) {
    await completeDeliveryAttempt({
      kind: 'SUCCESS',
      deliveryId: args.delivery.id,
      leaseToken: args.leaseToken,
      attemptedAt: args.attemptedAt,
      providerMessageId: args.sendResult.providerMessageId,
      providerStatus: args.sendResult.providerStatus,
      responseMeta: args.sendResult.responseMeta,
    })

    return {
      deliveryId: args.delivery.id,
      provider: args.delivery.provider,
      channel: args.delivery.channel,
      result: 'SENT',
    }
  }

  if (args.sendResult.retryable && hasRetryAttemptsRemaining(args.delivery)) {
    const nextAttemptAt = buildNextAttemptAt({
      attemptedAt: args.attemptedAt,
      nextAttemptCount: args.delivery.attemptCount + 1,
    })

    await completeDeliveryAttempt({
      kind: 'RETRYABLE_FAILURE',
      deliveryId: args.delivery.id,
      leaseToken: args.leaseToken,
      attemptedAt: args.attemptedAt,
      nextAttemptAt,
      code: args.sendResult.code,
      message: args.sendResult.message,
      providerStatus: args.sendResult.providerStatus,
      responseMeta: args.sendResult.responseMeta,
    })

    return {
      deliveryId: args.delivery.id,
      provider: args.delivery.provider,
      channel: args.delivery.channel,
      result: 'RETRY_SCHEDULED',
      nextAttemptAt,
    }
  }

  await completeDeliveryAttempt({
    kind: 'FINAL_FAILURE',
    deliveryId: args.delivery.id,
    leaseToken: args.leaseToken,
    attemptedAt: args.attemptedAt,
    code: args.sendResult.code,
    message: args.sendResult.message,
    providerStatus: args.sendResult.providerStatus,
    responseMeta: args.sendResult.responseMeta,
  })

  return {
    deliveryId: args.delivery.id,
    provider: args.delivery.provider,
    channel: args.delivery.channel,
    result: 'FAILED_FINAL',
  }
}

async function processClaimedDelivery(args: {
  delivery: ClaimedNotificationDelivery
  providers: DeliveryProviderRegistry
  now: Date
}): Promise<ProcessedDeliveryOutcome> {
  const leaseToken = args.delivery.leaseToken

  if (!leaseToken) {
    return {
      deliveryId: args.delivery.id,
      provider: args.delivery.provider,
      channel: args.delivery.channel,
      result: 'ORCHESTRATION_ERROR',
      message:
        'Claimed delivery is missing leaseToken. Delivery could not be finalized because lease ownership is required.',
    }
  }

  try {
    const request = buildProviderRequest(args.delivery)
    const sendResult = await sendWithProvider({
      request,
      providers: args.providers,
    })

    return finalizeSendResult({
      delivery: args.delivery,
      leaseToken,
      attemptedAt: args.now,
      sendResult,
    })
  } catch (error) {
    const message = normalizeErrorMessage(
      error,
      'Unknown orchestration error.',
    )

    const finalizedMessage = await finalizeOrchestrationFailure({
      delivery: args.delivery,
      leaseToken,
      attemptedAt: args.now,
      message,
    })

    return {
      deliveryId: args.delivery.id,
      provider: args.delivery.provider,
      channel: args.delivery.channel,
      result: 'ORCHESTRATION_ERROR',
      message: finalizedMessage,
    }
  }
}

function buildResultSummary(args: {
  claimedCount: number
  outcomes: ProcessedDeliveryOutcome[]
}): ProcessDueDeliveriesResult {
  let sentCount = 0
  let retryScheduledCount = 0
  let finalFailureCount = 0
  let orchestrationErrorCount = 0

  for (const outcome of args.outcomes) {
    switch (outcome.result) {
      case 'SENT':
        sentCount += 1
        break

      case 'RETRY_SCHEDULED':
        retryScheduledCount += 1
        break

      case 'FAILED_FINAL':
        finalFailureCount += 1
        break

      case 'ORCHESTRATION_ERROR':
        orchestrationErrorCount += 1
        break
    }
  }

  return {
    claimedCount: args.claimedCount,
    processedCount: args.outcomes.length,
    sentCount,
    retryScheduledCount,
    finalFailureCount,
    orchestrationErrorCount,
    outcomes: args.outcomes,
  }
}

export async function processDueDeliveries(args: {
  providers: DeliveryProviderRegistry
  claim?: ProcessDueDeliveriesArgs
}): Promise<ProcessDueDeliveriesResult> {
  const now = normalizeNow(args.claim?.now)

  const claimed = await claimDeliveries({
    ...args.claim,
    now,
  })

  const outcomes: ProcessedDeliveryOutcome[] = []

  for (const delivery of claimed.deliveries) {
    const outcome = await processClaimedDelivery({
      delivery,
      providers: args.providers,
      now,
    })

    outcomes.push(outcome)
  }

  return buildResultSummary({
    claimedCount: claimed.deliveries.length,
    outcomes,
  })
}