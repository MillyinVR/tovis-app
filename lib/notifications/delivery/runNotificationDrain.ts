// lib/notifications/delivery/runNotificationDrain.ts
//
// Shared notification-queue drain: builds the delivery provider registry and
// claims + sends due NotificationDelivery rows. Used by BOTH the scheduled cron
// (app/api/internal/jobs/notifications/process) and the immediate post-commit
// kick (kickNotificationDrain) so a freshly-enqueued email/SMS goes out in
// seconds instead of waiting for the next cron tick — without duplicating the
// provider wiring or the claim semantics.
import { NotificationChannel, NotificationProvider } from '@prisma/client'
import Twilio from 'twilio'

import {
  processDueDeliveries,
  type DeliveryProviderRegistry,
  type ProcessDueDeliveriesResult,
} from '@/lib/notifications/delivery/processDueDeliveries'
import {
  type EmailProviderSendRequest,
  type InAppProviderSendRequest,
  type NotificationDeliveryProvider,
  type PushProviderSendRequest,
  type SmsProviderSendRequest,
} from '@/lib/notifications/delivery/providerTypes'
import { createEmailDeliveryProvider } from '@/lib/notifications/delivery/sendEmail'
import { createInAppDeliveryProvider } from '@/lib/notifications/delivery/sendInApp'
import {
  createApnsDeliveryProvider,
  createFcmDeliveryProvider,
} from '@/lib/notifications/delivery/sendPush'
import { createSmsDeliveryProvider } from '@/lib/notifications/delivery/sendSms'
import {
  isNotificationProviderConfigError,
  readPostmarkEmailConfig,
  readTwilioSmsConfig,
} from '@/lib/notifications/config'
import { getRedis } from '@/lib/redis'
import { rootTenantContext } from '@/lib/tenant/context'
import { getRootTenantId } from '@/lib/tenant/resolveTenant'

export const NOTIFICATION_DRAIN_DEFAULT_BATCH = 100
export const NOTIFICATION_DRAIN_MAX_BATCH = 250

// Lease must exceed the drain function's wall-clock ceiling. The process cron
// runs every 60s with maxDuration=60s, and a batch is leased up front then
// processed serially. With a 60s lease (≈ the cron period AND the function
// timeout) a slow batch's early-claimed rows could free up WHILE this drain was
// still working through them — letting the next cron tick reclaim and re-send the
// same delivery (a real duplicate, billed Twilio/Postmark message). 120s >
// maxDuration guarantees no row a live drain still holds is reclaimable by an
// overlapping tick; a row only frees once the holding function is provably dead.
// (Residual at-least-once on a crash AFTER a provider send but BEFORE recording
// completion remains — Twilio/Postmark expose no native idempotency key; tracked
// as a follow-up.)
export const NOTIFICATION_DRAIN_LEASE_MS = 120_000

function buildRealtimeChannel(recipientInAppTargetId: string): string {
  return `notifications:in-app:${recipientInAppTargetId}`
}

function buildRealtimeVersionKey(recipientInAppTargetId: string): string {
  return `notifications:in-app:${recipientInAppTargetId}:version`
}

function buildInAppProvider(): NotificationDeliveryProvider<InAppProviderSendRequest> {
  const inAppProvider = createInAppDeliveryProvider({
    publish: async (envelope) => {
      const redis = getRedis()
      if (!redis) {
        throw new Error(
          'Redis is not configured. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN).',
        )
      }

      const channel = buildRealtimeChannel(envelope.recipientInAppTargetId)
      const versionKey = buildRealtimeVersionKey(
        envelope.recipientInAppTargetId,
      )
      const payload = JSON.stringify(envelope)

      const [subscriberCount, version] = await Promise.all([
        redis.publish(channel, payload),
        redis.incr(versionKey),
      ])

      return {
        accepted: true,
        providerMessageId: envelope.idempotencyKey,
        providerStatus: 'published',
        responseMeta: {
          source: 'lib/notifications/delivery/runNotificationDrain',
          channel,
          version,
          subscriberCount,
        },
      }
    },
  })

  return {
    provider: NotificationProvider.INTERNAL_REALTIME,
    channel: NotificationChannel.IN_APP,
    send(request) {
      return inAppProvider.send(request)
    },
  }
}

function buildSmsProvider(): NotificationDeliveryProvider<SmsProviderSendRequest> | null {
  // Only stand up the SMS provider when Twilio is actually configured. Reuse the
  // enqueue-gate config reader (lib/notifications/config) so a config that passes
  // the enqueue gate cannot 500 the worker, and so a missing var degrades to "no
  // SMS provider" instead of throwing and killing in-app/email delivery too.
  const config = readTwilioSmsConfig()
  if (!config) return null

  const twilioClient = Twilio(config.accountSid, config.authToken)

  const smsProvider = createSmsDeliveryProvider({
    fromNumber: config.fromNumber,
    client: {
      messages: {
        async create(params) {
          const message = await twilioClient.messages.create({
            from: params.from,
            to: params.to,
            body: params.body,
            statusCallback: params.statusCallback,
          })

          return {
            to: message.to ?? params.to,
            body: message.body ?? params.body,
            status: message.status ?? null,
            sid: message.sid ?? null,
          }
        },
      },
    },
  })

  return {
    provider: NotificationProvider.TWILIO,
    channel: NotificationChannel.SMS,
    send(request) {
      return smsProvider.send(request)
    },
  }
}

function buildEmailProvider(): NotificationDeliveryProvider<EmailProviderSendRequest> | null {
  // Only stand up the email provider when Postmark is configured, via the same
  // config reader the enqueue gate uses (unifies env-name handling across both
  // sides — POSTMARK_SERVER_TOKEN/POSTMARK_API_TOKEN, etc.).
  const config = readPostmarkEmailConfig()
  if (!config) return null

  const emailProvider = createEmailDeliveryProvider({
    apiToken: config.serverToken,
    fromEmail: config.fromEmail,
    messageStream: config.messageStream,
  })

  return {
    provider: NotificationProvider.POSTMARK,
    channel: NotificationChannel.EMAIL,
    send(request) {
      return emailProvider.send(request)
    },
  }
}

function buildApnsProvider(): NotificationDeliveryProvider<PushProviderSendRequest> | null {
  // Only stand up the APNs provider when credentials are configured. Mirror
  // buildSmsProvider: createApnsDeliveryProvider throws a config error when
  // unconfigured, which we swallow to a null provider so a missing var degrades
  // to "no APNs provider" instead of crashing the worker and taking down the
  // other channels. (isPushProviderConfigured still gates enqueue, so absent
  // creds means no PUSH rows are ever created anyway.)
  try {
    return createApnsDeliveryProvider()
  } catch (error) {
    if (isNotificationProviderConfigError(error)) return null
    throw error
  }
}

function buildFcmProvider(): NotificationDeliveryProvider<PushProviderSendRequest> | null {
  // See buildApnsProvider — same configured-or-null contract for FCM.
  try {
    return createFcmDeliveryProvider()
  } catch (error) {
    if (isNotificationProviderConfigError(error)) return null
    throw error
  }
}

export function buildNotificationProviderRegistry(): DeliveryProviderRegistry {
  // In-app needs no external provider and must always be available. SMS, email and
  // push are included only when configured; when absent their deliveries stay
  // claimable (see processDueDeliveries) rather than taking down the whole worker.
  return {
    inApp: buildInAppProvider(),
    sms: buildSmsProvider(),
    email: buildEmailProvider(),
    apns: buildApnsProvider(),
    fcm: buildFcmProvider(),
  }
}

/**
 * Claim and send all currently-due notification deliveries. Safe to run
 * concurrently with the cron and with other kicks — claimDeliveries leases rows
 * atomically, so overlapping drains never double-send. Renders root-brand copy
 * (background job has no tenant host).
 */
export async function drainDueNotifications(args?: {
  batchSize?: number
  now?: Date
}): Promise<ProcessDueDeliveriesResult> {
  const now = args?.now ?? new Date()
  const batchSize = Math.max(
    1,
    Math.min(args?.batchSize ?? NOTIFICATION_DRAIN_DEFAULT_BATCH, NOTIFICATION_DRAIN_MAX_BATCH),
  )

  const tenantContext = rootTenantContext(await getRootTenantId())

  return processDueDeliveries({
    providers: buildNotificationProviderRegistry(),
    tenantContext,
    claim: {
      now,
      batchSize,
      leaseMs: NOTIFICATION_DRAIN_LEASE_MS,
    },
  })
}
