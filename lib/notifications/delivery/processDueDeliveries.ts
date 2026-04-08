import {
  NotificationChannel,
  NotificationProvider,
} from '@prisma/client'

import {
  claimDeliveries,
  type ClaimDeliveriesArgs,
  type ClaimedNotificationDelivery,
} from './claimDeliveries'
import { completeDeliveryAttempt } from './completeDeliveryAttempt'
import { buildProviderSendRequest } from './providerPolicy'
import { renderNotificationContent } from './renderNotificationContent'
import { type NotificationTemplateKey } from '../eventKeys'
import { type ProviderSendResult } from './providerTypes'
import { type EmailDeliveryProvider } from './sendEmail'
import { type InAppDeliveryProvider } from './sendInApp'
import { type SmsDeliveryProvider } from './sendSms'

const RETRY_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
] as const

const VALID_TEMPLATE_KEYS = new Set<NotificationTemplateKey>([
  'booking_request_created',
  'booking_confirmed',
  'booking_rescheduled',
  'booking_cancelled_by_client',
  'booking_cancelled_by_pro',
  'booking_cancelled_by_admin',
  'consultation_proposal_sent',
  'consultation_approved',
  'consultation_rejected',
  'review_received',
  'appointment_reminder',
  'aftercare_ready',
  'last_minute_opening_available',
  'payment_collected',
  'payment_action_required',
])

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
  inApp: InAppDeliveryProvider
  sms: SmsDeliveryProvider
  email: EmailDeliveryProvider
}

function normalizeNow(value: Date | undefined): Date {
  const now = value ?? new Date()

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('processDueDeliveries: invalid now')
  }

  return now
}

function normalizeTemplateKey(value: string): NotificationTemplateKey {
  if (VALID_TEMPLATE_KEYS.has(value as NotificationTemplateKey)) {
    return value as NotificationTemplateKey
  }

  throw new Error(`processDueDeliveries: unsupported templateKey ${value}`)
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

function buildProviderRequest(delivery: ClaimedNotificationDelivery) {
  const content = renderNotificationContent({
    channel: delivery.channel,
    templateKey: normalizeTemplateKey(delivery.templateKey),
    templateVersion: delivery.templateVersion,
    dispatch: {
      eventKey: delivery.dispatch.eventKey,
      title: delivery.dispatch.title,
      body: delivery.dispatch.body,
      href: delivery.dispatch.href,
      payload: delivery.dispatch.payload,
    },
  })

  return buildProviderSendRequest({
    deliveryId: delivery.id,
    dispatchId: delivery.dispatch.id,
    destination: delivery.destination ?? '',
    attemptCount: delivery.attemptCount,
    content,
    metadata: {
      sourceKey: delivery.dispatch.sourceKey,
      eventKey: delivery.dispatch.eventKey,
      channel: delivery.channel,
      provider: delivery.provider,
    },
  })
}

async function processClaimedDelivery(args: {
  delivery: ClaimedNotificationDelivery
  providers: DeliveryProviderRegistry
  now: Date
}): Promise<ProcessedDeliveryOutcome> {
  const request = buildProviderRequest(args.delivery)

  let sendResult: ProviderSendResult

  try {
    if (request.provider === NotificationProvider.INTERNAL_REALTIME) {
      sendResult = await args.providers.inApp.send(request)
    } else if (request.provider === NotificationProvider.TWILIO) {
      sendResult = await args.providers.sms.send(request)
    } else {
      sendResult = await args.providers.email.send(request)
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Unknown orchestration error.'

    await completeDeliveryAttempt({
      kind: 'FINAL_FAILURE',
      deliveryId: args.delivery.id,
      leaseToken: args.delivery.leaseToken ?? '',
      attemptedAt: args.now,
      code: 'DELIVERY_ORCHESTRATION_ERROR',
      message,
      providerStatus: 'orchestration_error',
      responseMeta: {
        source: 'processDueDeliveries',
        provider: args.delivery.provider,
        channel: args.delivery.channel,
      },
    })

    return {
      deliveryId: args.delivery.id,
      provider: args.delivery.provider,
      channel: args.delivery.channel,
      result: 'ORCHESTRATION_ERROR',
      message,
    }
  }

  if (sendResult.ok) {
    await completeDeliveryAttempt({
      kind: 'SUCCESS',
      deliveryId: args.delivery.id,
      leaseToken: args.delivery.leaseToken ?? '',
      attemptedAt: args.now,
      providerMessageId: sendResult.providerMessageId,
      providerStatus: sendResult.providerStatus,
      responseMeta: sendResult.responseMeta,
    })

    return {
      deliveryId: args.delivery.id,
      provider: args.delivery.provider,
      channel: args.delivery.channel,
      result: 'SENT',
    }
  }

  if (
    sendResult.retryable &&
    args.delivery.attemptCount < args.delivery.maxAttempts - 1
  ) {
    const nextAttemptAt = buildNextAttemptAt({
      attemptedAt: args.now,
      nextAttemptCount: args.delivery.attemptCount + 1,
    })

    await completeDeliveryAttempt({
      kind: 'RETRYABLE_FAILURE',
      deliveryId: args.delivery.id,
      leaseToken: args.delivery.leaseToken ?? '',
      attemptedAt: args.now,
      nextAttemptAt,
      code: sendResult.code,
      message: sendResult.message,
      providerStatus: sendResult.providerStatus,
      responseMeta: sendResult.responseMeta,
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
    leaseToken: args.delivery.leaseToken ?? '',
    attemptedAt: args.now,
    code: sendResult.code,
    message: sendResult.message,
    providerStatus: sendResult.providerStatus,
    responseMeta: sendResult.responseMeta,
  })

  return {
    deliveryId: args.delivery.id,
    provider: args.delivery.provider,
    channel: args.delivery.channel,
    result: 'FAILED_FINAL',
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
    if (!delivery.leaseToken) {
      await completeDeliveryAttempt({
        kind: 'FINAL_FAILURE',
        deliveryId: delivery.id,
        leaseToken: '',
        attemptedAt: now,
        code: 'DELIVERY_LEASE_MISSING',
        message: 'Claimed delivery is missing leaseToken.',
        providerStatus: 'invalid_claim',
        responseMeta: {
          source: 'processDueDeliveries',
        },
      }).catch(() => {
        // Intentionally swallow here so one malformed row does not block the batch.
      })

      outcomes.push({
        deliveryId: delivery.id,
        provider: delivery.provider,
        channel: delivery.channel,
        result: 'ORCHESTRATION_ERROR',
        message: 'Claimed delivery is missing leaseToken.',
      })
      continue
    }

    try {
      const outcome = await processClaimedDelivery({
        delivery,
        providers: args.providers,
        now,
      })

      outcomes.push(outcome)
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unknown orchestration error.'

      outcomes.push({
        deliveryId: delivery.id,
        provider: delivery.provider,
        channel: delivery.channel,
        result: 'ORCHESTRATION_ERROR',
        message,
      })
    }
  }

  return {
    claimedCount: claimed.deliveries.length,
    processedCount: outcomes.length,
    sentCount: outcomes.filter((outcome) => outcome.result === 'SENT').length,
    retryScheduledCount: outcomes.filter(
      (outcome) => outcome.result === 'RETRY_SCHEDULED',
    ).length,
    finalFailureCount: outcomes.filter(
      (outcome) => outcome.result === 'FAILED_FINAL',
    ).length,
    orchestrationErrorCount: outcomes.filter(
      (outcome) => outcome.result === 'ORCHESTRATION_ERROR',
    ).length,
    outcomes,
  }
}