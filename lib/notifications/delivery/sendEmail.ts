// lib/notifications/delivery/sendEmail.ts

import {
  NotificationChannel,
  NotificationProvider,
} from '@prisma/client'

import { asTrimmedString } from '@/lib/guards'
import {
  LOAD_TEST_SUPPRESSED_STATUS,
  realDeliverySuppressed,
} from '@/lib/loadTestDelivery'
import {
  requirePostmarkEmailConfig,
  isNotificationProviderConfigError,
} from '@/lib/notifications/config'
import {
  mapProviderSendFailureToDeliveryTransition,
} from '@/lib/notifications/providerStatus'

import {
  type EmailProviderSendRequest,
  type NotificationDeliveryProvider,
  type ProviderSendResult,
} from './providerTypes'

export type PostmarkEmailRequest = {
  From: string
  To: string
  Subject: string
  TextBody: string
  HtmlBody: string
  MessageStream?: string
  Metadata?: Record<string, string>
}

export type PostmarkEmailResponse = {
  MessageID?: string | null
  ErrorCode?: number | string | null
  Message?: string | null
  SubmittedAt?: string | null
  To?: string | null
}

export type SendEmailProviderOptions = {
  apiToken?: string
  fromEmail?: string
  messageStream?: string | null
  fetchImpl?: typeof fetch
}

const POSTMARK_SEND_URL = 'https://api.postmarkapp.com/email'

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim()

  if (!normalized) {
    throw new Error(`sendEmail: missing ${fieldName}`)
  }

  return normalized
}

function readPostmarkErrorCode(value: number | string | null | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  return '0'
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function isRetryablePostmarkApiCode(code: string): boolean {
  const numeric = Number(code)

  if (!Number.isFinite(numeric)) {
    return false
  }

  return numeric === 429 || numeric >= 500
}

function buildConfigurationFailure(message: string): ProviderSendResult {
  const transition = mapProviderSendFailureToDeliveryTransition('FAILED_FINAL')

  return {
    ok: false,
    retryable: false,
    code: 'EMAIL_PROVIDER_MISCONFIGURED',
    message,
    providerStatus: 'misconfigured',
    responseMeta: {
      source: 'sendEmail',
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
    code: 'EMAIL_REQUEST_INVALID',
    message,
    providerStatus: 'invalid_request',
    responseMeta: {
      source: 'sendEmail',
      nextStatus: transition.nextStatus,
      eventType: transition.eventType,
    },
  }
}

function buildThrownFailure(error: unknown): ProviderSendResult {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : 'Unknown email provider error.'

  const transition = mapProviderSendFailureToDeliveryTransition(
    'FAILED_RETRYABLE',
  )

  return {
    ok: false,
    retryable: true,
    code: 'EMAIL_PROVIDER_ERROR',
    message,
    providerStatus: 'retryable_error',
    responseMeta: {
      source: 'sendEmail',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      nextStatus: transition.nextStatus,
      eventType: transition.eventType,
    },
  }
}

function buildMetadata(
  request: EmailProviderSendRequest,
): Record<string, string> {
  return {
    deliveryId: request.deliveryId,
    dispatchId: request.dispatchId,
    idempotencyKey: request.idempotencyKey,
    provider: request.provider,
    channel: request.channel,
  }
}

function buildPostmarkRequest(args: {
  fromEmail: string
  messageStream: string | null
  request: EmailProviderSendRequest
}): PostmarkEmailRequest {
  return {
    From: normalizeRequiredString(args.fromEmail, 'fromEmail'),
    To: normalizeRequiredString(args.request.destination, 'destination'),
    Subject: normalizeRequiredString(
      args.request.content.subject,
      'content.subject',
    ),
    TextBody: normalizeRequiredString(
      args.request.content.text,
      'content.text',
    ),
    HtmlBody: normalizeRequiredString(
      args.request.content.html,
      'content.html',
    ),
    ...(args.messageStream ? { MessageStream: args.messageStream } : {}),
    Metadata: buildMetadata(args.request),
  }
}

function mapHttpFailure(args: {
  status: number
  bodyText: string
}): ProviderSendResult {
  const retryable = isRetryableHttpStatus(args.status)
  const transition = mapProviderSendFailureToDeliveryTransition(
    retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
  )

  return {
    ok: false,
    retryable,
    code: `POSTMARK_HTTP_${args.status}`,
    message:
      args.bodyText || `Postmark request failed with HTTP ${args.status}.`,
    providerStatus: `http_${args.status}`,
    responseMeta: {
      source: 'sendEmail',
      status: args.status,
      bodyText: args.bodyText,
      nextStatus: transition.nextStatus,
      eventType: transition.eventType,
    },
  }
}

function mapApiFailure(args: {
  response: PostmarkEmailResponse
}): ProviderSendResult {
  const errorCode = readPostmarkErrorCode(args.response.ErrorCode)
  const retryable = isRetryablePostmarkApiCode(errorCode)

  const transition = mapProviderSendFailureToDeliveryTransition(
    retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
  )

  return {
    ok: false,
    retryable,
    code: `POSTMARK_API_${errorCode}`,
    message:
      asTrimmedString(args.response.Message) ??
      'Postmark API rejected the email.',
    providerStatus: retryable ? 'retryable_error' : 'rejected',
    responseMeta: {
      source: 'sendEmail',
      errorCode,
      to: asTrimmedString(args.response.To),
      submittedAt: asTrimmedString(args.response.SubmittedAt),
      nextStatus: transition.nextStatus,
      eventType: transition.eventType,
    },
  }
}

function buildInvalidResponseFailure(rawText: string): ProviderSendResult {
  const transition = mapProviderSendFailureToDeliveryTransition(
    'FAILED_RETRYABLE',
  )

  return {
    ok: false,
    retryable: true,
    code: 'POSTMARK_INVALID_RESPONSE',
    message: 'Postmark returned an unreadable response body.',
    providerStatus: 'invalid_response',
    responseMeta: {
      source: 'sendEmail',
      bodyText: rawText,
      nextStatus: transition.nextStatus,
      eventType: transition.eventType,
    },
  }
}

function parsePostmarkResponse(rawText: string): PostmarkEmailResponse | null {
  if (!rawText.trim()) return null

  try {
    const parsed: unknown = JSON.parse(rawText)

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }

    const record = parsed as Record<string, unknown>

    return {
      MessageID:
        typeof record.MessageID === 'string' || record.MessageID === null
          ? record.MessageID
          : undefined,
      ErrorCode:
        typeof record.ErrorCode === 'number' ||
        typeof record.ErrorCode === 'string' ||
        record.ErrorCode === null
          ? record.ErrorCode
          : undefined,
      Message:
        typeof record.Message === 'string' || record.Message === null
          ? record.Message
          : undefined,
      SubmittedAt:
        typeof record.SubmittedAt === 'string' || record.SubmittedAt === null
          ? record.SubmittedAt
          : undefined,
      To:
        typeof record.To === 'string' || record.To === null
          ? record.To
          : undefined,
    }
  } catch {
    return null
  }
}

function resolvePostmarkOptions(options: SendEmailProviderOptions): {
  apiToken: string
  fromEmail: string
  messageStream: string | null
  fetchImpl: typeof fetch
} {
  const fetchImpl = options.fetchImpl === undefined ? fetch : options.fetchImpl

  const hasInjectedConfig =
    options.apiToken !== undefined || options.fromEmail !== undefined

  if (hasInjectedConfig) {
    return {
      apiToken: normalizeRequiredString(options.apiToken ?? '', 'apiToken'),
      fromEmail: normalizeRequiredString(options.fromEmail ?? '', 'fromEmail'),
      messageStream: asTrimmedString(options.messageStream),
      fetchImpl,
    }
  }

  const config = requirePostmarkEmailConfig()

  return {
    apiToken: config.serverToken,
    fromEmail: config.fromEmail,
    messageStream:
      options.messageStream === undefined
        ? config.messageStream
        : asTrimmedString(options.messageStream),
    fetchImpl,
  }
}

export class EmailDeliveryProvider
  implements NotificationDeliveryProvider<EmailProviderSendRequest>
{
  readonly provider = NotificationProvider.POSTMARK
  readonly channel = NotificationChannel.EMAIL

  private readonly apiToken: string
  private readonly fromEmail: string
  private readonly messageStream: string | null
  private readonly fetchImpl: typeof fetch

  constructor(options: SendEmailProviderOptions = {}) {
    const resolved = resolvePostmarkOptions(options)

    this.apiToken = resolved.apiToken
    this.fromEmail = resolved.fromEmail
    this.messageStream = resolved.messageStream
    this.fetchImpl = resolved.fetchImpl

    if (typeof this.fetchImpl !== 'function') {
      throw new Error('sendEmail: fetchImpl must be a function')
    }
  }

  async send(request: EmailProviderSendRequest): Promise<ProviderSendResult> {
    if (request.provider !== NotificationProvider.POSTMARK) {
      return buildConfigurationFailure(
        'Expected POSTMARK provider for email delivery.',
      )
    }

    if (request.channel !== NotificationChannel.EMAIL) {
      return buildConfigurationFailure(
        'Expected EMAIL channel for email delivery.',
      )
    }

    if (realDeliverySuppressed()) {
      return {
        ok: true,
        providerMessageId: request.idempotencyKey,
        providerStatus: LOAD_TEST_SUPPRESSED_STATUS,
        responseMeta: { source: 'sendEmail', suppressed: true },
      }
    }

    let postmarkRequest: PostmarkEmailRequest

    try {
      postmarkRequest = buildPostmarkRequest({
        fromEmail: this.fromEmail,
        messageStream: this.messageStream,
        request,
      })
    } catch (error) {
      return buildRequestFailure(
        error instanceof Error ? error.message : 'Invalid email send request.',
      )
    }

    try {
      const response = await this.fetchImpl(POSTMARK_SEND_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': this.apiToken,
        },
        body: JSON.stringify(postmarkRequest),
      })

      const rawText = await response.text()
      const parsed = parsePostmarkResponse(rawText)

      if (!response.ok) {
        return mapHttpFailure({
          status: response.status,
          bodyText: rawText,
        })
      }

      if (!parsed) {
        return buildInvalidResponseFailure(rawText)
      }

      if (readPostmarkErrorCode(parsed.ErrorCode) !== '0') {
        return mapApiFailure({ response: parsed })
      }

      return {
        ok: true,
        providerMessageId:
          asTrimmedString(parsed.MessageID) ?? request.idempotencyKey,
        providerStatus: 'accepted',
        responseMeta: {
          source: 'sendEmail',
          to: asTrimmedString(parsed.To) ?? request.destination,
          submittedAt: asTrimmedString(parsed.SubmittedAt),
          messageStream: this.messageStream,
        },
      }
    } catch (error) {
      return buildThrownFailure(error)
    }
  }
}

export function createEmailDeliveryProvider(
  options: SendEmailProviderOptions = {},
): EmailDeliveryProvider {
  try {
    return new EmailDeliveryProvider(options)
  } catch (error) {
    if (isNotificationProviderConfigError(error)) {
      throw error
    }

    throw error
  }
}