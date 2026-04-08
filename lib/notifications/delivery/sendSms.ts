import {
  NotificationChannel,
  NotificationProvider,
  Prisma,
} from '@prisma/client'

import {
  type NotificationDeliveryProvider,
  type ProviderSendResult,
  type SmsProviderSendRequest,
} from './providerTypes'

export type TwilioSmsMessage = {
  to: string
  body: string
  status?: string | null
  sid?: string | null
}

export type TwilioSmsSendParams = {
  to: string
  body: string
}

export type TwilioSmsClient = {
  messages: {
    create(params: TwilioSmsSendParams): Promise<TwilioSmsMessage>
  }
}

export type SendSmsProviderOptions = {
  client: TwilioSmsClient
}

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim()

  if (!normalized) {
    throw new Error(`sendSms: missing ${fieldName}`)
  }

  return normalized
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function buildConfigurationFailure(message: string): ProviderSendResult {
  return {
    ok: false,
    retryable: false,
    code: 'SMS_PROVIDER_MISCONFIGURED',
    message,
    providerStatus: 'misconfigured',
    responseMeta: {
      source: 'sendSms',
    },
  }
}

function buildRequestFailure(message: string): ProviderSendResult {
  return {
    ok: false,
    retryable: false,
    code: 'SMS_REQUEST_INVALID',
    message,
    providerStatus: 'invalid_request',
    responseMeta: {
      source: 'sendSms',
    },
  }
}

function buildThrownFailure(error: unknown): ProviderSendResult {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'Unknown SMS provider error.'

  return {
    ok: false,
    retryable: true,
    code: 'SMS_PROVIDER_ERROR',
    message,
    providerStatus: 'error',
    responseMeta: {
      source: 'sendSms',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    },
  }
}

function buildTwilioParams(request: SmsProviderSendRequest): TwilioSmsSendParams {
  return {
    to: normalizeRequiredString(request.destination, 'destination'),
    body: normalizeRequiredString(request.content.text, 'content.text'),
  }
}

export class SmsDeliveryProvider
  implements NotificationDeliveryProvider<SmsProviderSendRequest>
{
  readonly provider = NotificationProvider.TWILIO
  readonly channel = NotificationChannel.SMS

  private readonly client: TwilioSmsClient

  constructor(options: SendSmsProviderOptions) {
    if (!options.client || typeof options.client !== 'object') {
      throw new Error('sendSms: client must be provided')
    }

    if (
      !options.client.messages ||
      typeof options.client.messages !== 'object' ||
      typeof options.client.messages.create !== 'function'
    ) {
      throw new Error('sendSms: client.messages.create must be a function')
    }

    this.client = options.client
  }

  async send(request: SmsProviderSendRequest): Promise<ProviderSendResult> {
    if (request.provider !== NotificationProvider.TWILIO) {
      return buildConfigurationFailure('Expected TWILIO provider for SMS delivery.')
    }

    if (request.channel !== NotificationChannel.SMS) {
      return buildConfigurationFailure('Expected SMS channel for SMS delivery.')
    }

    let params: TwilioSmsSendParams

    try {
      params = buildTwilioParams(request)
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
          normalizeOptionalString(response.sid) ?? request.idempotencyKey,
        providerStatus:
          normalizeOptionalString(response.status) ?? 'accepted',
        responseMeta: {
          source: 'sendSms',
          to: response.to,
        },
      }
    } catch (error) {
      return buildThrownFailure(error)
    }
  }
}

export function createSmsDeliveryProvider(
  options: SendSmsProviderOptions,
): SmsDeliveryProvider {
  return new SmsDeliveryProvider(options)
}