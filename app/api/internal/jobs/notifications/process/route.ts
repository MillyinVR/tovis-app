// app/api/internal/jobs/notifications/process/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import {
  processDueDeliveries,
  type DeliveryProviderRegistry,
} from '@/lib/notifications/delivery/processDueDeliveries'
import {
  type EmailProviderSendRequest,
  type InAppProviderSendRequest,
  type NotificationDeliveryProvider,
  type SmsProviderSendRequest,
} from '@/lib/notifications/delivery/providerTypes'
import { createEmailDeliveryProvider } from '@/lib/notifications/delivery/sendEmail'
import { createInAppDeliveryProvider } from '@/lib/notifications/delivery/sendInApp'
import { createSmsDeliveryProvider } from '@/lib/notifications/delivery/sendSms'
import {
  readPostmarkEmailConfig,
  readTwilioSmsConfig,
} from '@/lib/notifications/config'
import { getRedis } from '@/lib/redis'
import { rootTenantContext } from '@/lib/tenant/context'
import { getRootTenantId } from '@/lib/tenant/resolveTenant'
import { NotificationChannel, NotificationProvider } from '@prisma/client'
import Twilio from 'twilio'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

const DEFAULT_TAKE = 100
const MAX_TAKE = 250

function readTake(req: Request): number {
  const url = new URL(req.url)
  const raw = url.searchParams.get('take')
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_TAKE

  if (!Number.isFinite(parsed)) return DEFAULT_TAKE
  return Math.max(1, Math.min(MAX_TAKE, parsed))
}

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
          source: 'app/api/internal/jobs/notifications/process',
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

function buildProviderRegistry(): DeliveryProviderRegistry {
  // In-app needs no external provider and must always be available. SMS and email
  // are included only when configured; when absent their deliveries stay claimable
  // (see processDueDeliveries) rather than taking down the whole worker.
  return {
    inApp: buildInAppProvider(),
    sms: buildSmsProvider(),
    email: buildEmailProvider(),
  }
}

async function runJob(req: Request) {
  const secret = getInternalJobSecret()
  if (!secret) {
    return jsonFail(
      500,
      'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    )
  }

  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  const take = readTake(req)
  const now = new Date()

  // Background job has no tenant host; deliveries render root-brand copy
  // until dispatches carry their own tenant attribution (WS-9).
  const tenantContext = rootTenantContext(await getRootTenantId())

  const result = await processDueDeliveries({
    providers: buildProviderRegistry(),
    tenantContext,
    claim: {
      now,
      batchSize: take,
    },
  })

  return jsonOk({
    ...result,
    take,
    processedAt: now.toISOString(),
  })
}

export async function GET(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('GET /api/internal/jobs/notifications/process error', {
      error: safeError(err),
    })

    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('POST /api/internal/jobs/notifications/process error', {
      error: safeError(err),
    })

    return jsonFail(500, 'Internal server error')
  }
}