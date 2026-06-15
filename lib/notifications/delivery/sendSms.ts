// lib/notifications/delivery/sendSms.ts

import Twilio from 'twilio'
import {
  NotificationChannel,
  NotificationProvider,
} from '@prisma/client'

import { asTrimmedString } from '@/lib/guards'
import {
  requireTwilioSmsConfig,
  isNotificationProviderConfigError,
} from '@/lib/notifications/config'

import {
  mapProviderErrorToSendFailureKind,
  mapProviderSendFailureToDeliveryTransition,
} from '@/lib/notifications/providerStatus'

import {
  type NotificationDeliveryProvider,
  type ProviderSendResult,
  type SmsProviderSendRequest,
} from './providerTypes'

export type TwilioSmsMessage = {
  to: string
  body?: string | null
  status?: string | null
  sid?: string | null
  errorCode?: number | string | null
  errorMessage?: string | null
}

export type TwilioSmsSendParams = {
  to: string
  from: string
  body: string
  statusCallback?: string
}

export type TwilioSmsClient = {
  messages: {
    create(params: TwilioSmsSendParams): Promise<TwilioSmsMessage>
  }
}

export type SendSmsProviderOptions = {
  client?: TwilioSmsClient
  fromNumber?: string
  statusCallbackUrl?: string | null
}

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim()

  if (!normalized) {
    throw new Error(`sendSms: missing ${fieldName}`)
  }

  return normalized
}

function readOptionalEnv(name: string): string | null {
  return asTrimmedString(process.env[name])
}

function readDefaultStatusCallbackUrl(): string | null {
  const explicit = readOptionalEnv('TWILIO_NOTIFICATION_STATUS_CALLBACK_URL')
  if (explicit) return explicit

  const appUrl = readOptionalEnv('NEXT_PUBLIC_APP_URL')
  if (!appUrl) return null

  return `${appUrl.replace(/\/+$/, '')}/api/internal/webhooks/twilio/notifications/status`
}

function readTwilioErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null

  const code = 'code' in error ? error.code : null

  if (typeof code === 'string' && code.trim()) return code.trim()
  if (typeof code === 'number' && Number.isFinite(code)) return String(code)

  return null
}

function readTwilioErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }

  return 'Unknown SMS provider error.'
}

function buildConfigurationFailure(message: string): ProviderSendResult {
  const transition = mapProviderSendFailureToDeliveryTransition('FAILED_FINAL')

  return {
    ok: false,
    retryable: false,
    code: 'SMS_PROVIDER_MISCONFIGURED',
    message,
    providerStatus: 'misconfigured',
    responseMeta: {
      source: 'sendSms',
      nextStatus: transition.nextStatus,
      eventType: transition.eventType,
    },
  }
}

function buildRequestFailure(message: string): ProviderSendResult {
  const transition = mapProviderSendFailureToDeliveryTransition('FAILED_FINAL')

  return {
    ok: false,
    retryable: false,
    code: 'SMS_REQUEST_INVALID',
    message,
    providerStatus: 'invalid_request',
    responseMeta: {
      source: 'sendSms',
      nextStatus: transition.nextStatus,
      eventType: transition.eventType,
    },
  }
}

function buildThrownFailure(error: unknown): ProviderSendResult {
  const errorCode = readTwilioErrorCode(error)
  const message = readTwilioErrorMessage(error)

  const failureKind = mapProviderErrorToSendFailureKind({
    provider: NotificationProvider.TWILIO,
    errorCode,
    errorMessage: message,
  })

  const transition = mapProviderSendFailureToDeliveryTransition(failureKind)

  return {
    ok: false,
    retryable: failureKind === 'FAILED_RETRYABLE',
    code: errorCode ?? 'SMS_PROVIDER_ERROR',
    message,
    providerStatus: failureKind === 'FAILED_RETRYABLE' ? 'retryable_error' : 'failed',
    responseMeta: {
      source: 'sendSms',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      nextStatus: transition.nextStatus,
      eventType: transition.eventType,
    },
  }
}

function buildTwilioParams(args: {
  request: SmsProviderSendRequest
  fromNumber: string
  statusCallbackUrl: string | null
}): TwilioSmsSendParams {
  const params: TwilioSmsSendParams = {
    to: normalizeRequiredString(args.request.destination, 'destination'),
    from: normalizeRequiredString(args.fromNumber, 'fromNumber'),
    body: normalizeRequiredString(args.request.content.text, 'content.text'),
  }

  if (args.statusCallbackUrl) {
    params.statusCallback = args.statusCallbackUrl
  }

  return params
}

function createTwilioClientFromConfig(): {
  client: TwilioSmsClient
  fromNumber: string
} {
  const config = requireTwilioSmsConfig()

  return {
    client: Twilio(config.accountSid, config.authToken),
    fromNumber: config.fromNumber,
  }
}

function resolveClientAndFromNumber(options: SendSmsProviderOptions): {
  client: TwilioSmsClient
  fromNumber: string
} {
  if (options.client) {
    const fromNumber = asTrimmedString(options.fromNumber)

    if (!fromNumber) {
      throw new Error(
        'sendSms: fromNumber must be provided when using an injected client',
      )
    }

    return {
      client: options.client,
      fromNumber,
    }
  }

  return createTwilioClientFromConfig()
}

export class SmsDeliveryProvider
  implements NotificationDeliveryProvider<SmsProviderSendRequest>
{
  readonly provider = NotificationProvider.TWILIO
  readonly channel = NotificationChannel.SMS

  private readonly client: TwilioSmsClient
  private readonly fromNumber: string
  private readonly statusCallbackUrl: string | null

  constructor(options: SendSmsProviderOptions = {}) {
    const resolved = resolveClientAndFromNumber(options)

    if (!resolved.client || typeof resolved.client !== 'object') {
      throw new Error('sendSms: client must be provided')
    }

    if (
      !resolved.client.messages ||
      typeof resolved.client.messages !== 'object' ||
      typeof resolved.client.messages.create !== 'function'
    ) {
      throw new Error('sendSms: client.messages.create must be a function')
    }

    this.client = resolved.client
    this.fromNumber = resolved.fromNumber
    this.statusCallbackUrl =
      options.statusCallbackUrl === undefined
        ? readDefaultStatusCallbackUrl()
        : asTrimmedString(options.statusCallbackUrl)
  }

  async send(request: SmsProviderSendRequest): Promise<ProviderSendResult> {
    if (request.provider !== NotificationProvider.TWILIO) {
      return buildConfigurationFailure(
        'Expected TWILIO provider for SMS delivery.',
      )
    }

    if (request.channel !== NotificationChannel.SMS) {
      return buildConfigurationFailure('Expected SMS channel for SMS delivery.')
    }

    let params: TwilioSmsSendParams

    try {
      params = buildTwilioParams({
        request,
        fromNumber: this.fromNumber,
        statusCallbackUrl: this.statusCallbackUrl,
      })
    } catch (error) {
      return buildRequestFailure(
        error instanceof Error ? error.message : 'Invalid SMS send request.',
      )
    }

    try {
      const response = await this.client.messages.create(params)

      return {
        ok: true,
        providerMessageId:
          asTrimmedString(response.sid) ?? request.idempotencyKey,
        providerStatus:
          asTrimmedString(response.status) ?? 'accepted',
        responseMeta: {
          source: 'sendSms',
          to: response.to,
          from: params.from,
          statusCallback: params.statusCallback ?? null,
        },
      }
    } catch (error) {
      return buildThrownFailure(error)
    }
  }
}

export function createSmsDeliveryProvider(
  options: SendSmsProviderOptions = {},
): SmsDeliveryProvider {
  try {
    return new SmsDeliveryProvider(options)
  } catch (error) {
    if (isNotificationProviderConfigError(error)) {
      throw error
    }

    throw error
  }
}