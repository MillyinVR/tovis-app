import {
  NotificationChannel,
  NotificationProvider,
  Prisma,
} from '@prisma/client'

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
  ErrorCode?: number
  Message?: string | null
  SubmittedAt?: string | null
  To?: string | null
}

export type SendEmailProviderOptions = {
  apiToken: string
  fromEmail: string
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

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function buildConfigurationFailure(message: string): ProviderSendResult {
  return {
    ok: false,
    retryable: false,
    code: 'EMAIL_PROVIDER_MISCONFIGURED',
    message,
    providerStatus: 'misconfigured',
    responseMeta: {
      source: 'sendEmail',
    },
  }
}

function buildRequestFailure(message: string): ProviderSendResult {
  return {
    ok: false,
    retryable: false,
    code: 'EMAIL_REQUEST_INVALID',
    message,
    providerStatus: 'invalid_request',
    responseMeta: {
      source: 'sendEmail',
    },
  }
}

function buildThrownFailure(error: unknown): ProviderSendResult {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'Unknown email provider error.'

  return {
    ok: false,
    retryable: true,
    code: 'EMAIL_PROVIDER_ERROR',
    message,
    providerStatus: 'error',
    responseMeta: {
      source: 'sendEmail',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    },
  }
}

function buildMetadata(
  request: EmailProviderSendRequest,
): Record<string, string> | undefined {
  const metadata: Record<string, string> = {
    deliveryId: request.deliveryId,
    dispatchId: request.dispatchId,
    idempotencyKey: request.idempotencyKey,
  }

  const provider = normalizeOptionalString(request.provider)
  if (provider) {
    metadata.provider = provider
  }

  return metadata
}

function buildPostmarkRequest(args: {
  fromEmail: string
  messageStream: string | null
  request: EmailProviderSendRequest
}): PostmarkEmailRequest {
  return {
    From: normalizeRequiredString(args.fromEmail, 'fromEmail'),
    To: normalizeRequiredString(args.request.destination, 'destination'),
    Subject: normalizeRequiredString(args.request.content.subject, 'content.subject'),
    TextBody: normalizeRequiredString(args.request.content.text, 'content.text'),
    HtmlBody: normalizeRequiredString(args.request.content.html, 'content.html'),
    ...(args.messageStream ? { MessageStream: args.messageStream } : {}),
    Metadata: buildMetadata(args.request),
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function mapHttpFailure(args: {
  status: number
  bodyText: string
}): ProviderSendResult {
  return {
    ok: false,
    retryable: isRetryableHttpStatus(args.status),
    code: `POSTMARK_HTTP_${args.status}`,
    message: args.bodyText || `Postmark request failed with HTTP ${args.status}.`,
    providerStatus: `http_${args.status}`,
    responseMeta: {
      source: 'sendEmail',
      status: args.status,
      bodyText: args.bodyText,
    },
  }
}

function mapApiFailure(args: {
  response: PostmarkEmailResponse
}): ProviderSendResult {
  const errorCode = args.response.ErrorCode ?? 0
  const retryable = errorCode >= 500 || errorCode === 429

  return {
    ok: false,
    retryable,
    code: `POSTMARK_API_${errorCode}`,
    message:
      normalizeOptionalString(args.response.Message) ??
      'Postmark API rejected the email.',
    providerStatus: 'rejected',
    responseMeta: {
      source: 'sendEmail',
      errorCode,
      to: normalizeOptionalString(args.response.To),
      submittedAt: normalizeOptionalString(args.response.SubmittedAt),
    },
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

  constructor(options: SendEmailProviderOptions) {
    this.apiToken = normalizeRequiredString(options.apiToken, 'apiToken')
    this.fromEmail = normalizeRequiredString(options.fromEmail, 'fromEmail')
    this.messageStream = normalizeOptionalString(options.messageStream)
    this.fetchImpl = options.fetchImpl ?? fetch

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
      let parsed: PostmarkEmailResponse | null = null

      try {
        parsed = rawText ? (JSON.parse(rawText) as PostmarkEmailResponse) : null
      } catch {
        parsed = null
      }

      if (!response.ok) {
        return mapHttpFailure({
          status: response.status,
          bodyText: rawText,
        })
      }

      if (!parsed) {
        return {
          ok: false,
          retryable: true,
          code: 'POSTMARK_INVALID_RESPONSE',
          message: 'Postmark returned an unreadable response body.',
          providerStatus: 'invalid_response',
          responseMeta: {
            source: 'sendEmail',
            bodyText: rawText,
          },
        }
      }

      if ((parsed.ErrorCode ?? 0) !== 0) {
        return mapApiFailure({ response: parsed })
      }

      return {
        ok: true,
        providerMessageId:
          normalizeOptionalString(parsed.MessageID) ?? request.idempotencyKey,
        providerStatus: 'accepted',
        responseMeta: {
          source: 'sendEmail',
          to: normalizeOptionalString(parsed.To) ?? request.destination,
          submittedAt: normalizeOptionalString(parsed.SubmittedAt),
        },
      }
    } catch (error) {
      return buildThrownFailure(error)
    }
  }
}

export function createEmailDeliveryProvider(
  options: SendEmailProviderOptions,
): EmailDeliveryProvider {
  return new EmailDeliveryProvider(options)
}