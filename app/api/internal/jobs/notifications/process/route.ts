// app/api/internal/jobs/notifications/process/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
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
import { getRedis } from '@/lib/redis'
import { NotificationChannel, NotificationProvider } from '@prisma/client'
import Twilio from 'twilio'

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

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : null
}

function requireEnv(name: string): string {
  const value = readEnv(name)
  if (!value) {
    throw new Error(`Missing ${name} configuration.`)
  }

  return value
}

function getJobSecret(): string | null {
  return readEnv('INTERNAL_JOB_SECRET') ?? readEnv('CRON_SECRET')
}

function isAuthorizedJobRequest(req: Request): boolean {
  const secret = getJobSecret()
  if (!secret) return false

  const authHeader = req.headers.get('authorization')
  if (authHeader === `Bearer ${secret}`) return true

  const internalHeader = req.headers.get('x-internal-job-secret')
  if (internalHeader === secret) return true

  return false
}

function buildRealtimeChannel(recipientInAppTargetId: string): string {
  return `notifications:in-app:${recipientInAppTargetId}`
}

function buildRealtimeVersionKey(recipientInAppTargetId: string): string {
  return `notifications:in-app:${recipientInAppTargetId}:version`
}

function buildProviderRegistry(): DeliveryProviderRegistry {
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

  const twilioClient = Twilio(
    requireEnv('TWILIO_ACCOUNT_SID'),
    requireEnv('TWILIO_AUTH_TOKEN'),
  )
  const twilioFromNumber = requireEnv('TWILIO_FROM_NUMBER')

  const smsProvider = createSmsDeliveryProvider({
    client: {
      messages: {
        async create(params) {
          const message = await twilioClient.messages.create({
            from: twilioFromNumber,
            to: params.to,
            body: params.body,
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

  const emailProvider = createEmailDeliveryProvider({
    apiToken: requireEnv('POSTMARK_SERVER_TOKEN'),
    fromEmail: requireEnv('POSTMARK_FROM_EMAIL'),
    messageStream: readEnv('POSTMARK_MESSAGE_STREAM'),
  })

  const inApp: NotificationDeliveryProvider<InAppProviderSendRequest> = {
    provider: NotificationProvider.INTERNAL_REALTIME,
    channel: NotificationChannel.IN_APP,
    send(request) {
      return inAppProvider.send(request)
    },
  }

  const sms: NotificationDeliveryProvider<SmsProviderSendRequest> = {
    provider: NotificationProvider.TWILIO,
    channel: NotificationChannel.SMS,
    send(request) {
      return smsProvider.send(request)
    },
  }

  const email: NotificationDeliveryProvider<EmailProviderSendRequest> = {
    provider: NotificationProvider.POSTMARK,
    channel: NotificationChannel.EMAIL,
    send(request) {
      return emailProvider.send(request)
    },
  }

  return {
    inApp,
    sms,
    email,
  }
}

async function runJob(req: Request) {
  const secret = getJobSecret()
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

  const result = await processDueDeliveries({
    providers: buildProviderRegistry(),
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
    console.error('GET /api/internal/jobs/notifications/process error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('POST /api/internal/jobs/notifications/process error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}