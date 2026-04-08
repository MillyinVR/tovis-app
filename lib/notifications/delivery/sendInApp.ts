// lib/notifications/delivery/sendInApp.ts

import {
  NotificationChannel,
  NotificationProvider,
  Prisma,
} from '@prisma/client'

import {
  type InAppProviderSendRequest,
  type NotificationDeliveryProvider,
  type ProviderSendResult,
} from './providerTypes'

export type InAppRealtimeEnvelope = {
  kind: 'notification.in_app'
  deliveryId: string
  dispatchId: string
  recipientInAppTargetId: string
  idempotencyKey: string
  content: {
    title: string
    body: string
    href: string
    templateKey: string
    templateVersion: number
  }
  metadata?: Prisma.InputJsonValue | null
}

export type InAppPublishResult = {
  accepted: boolean
  providerMessageId?: string | null
  providerStatus?: string | null
  responseMeta?: Prisma.InputJsonValue | null
}

export type InAppPublisher = (envelope: InAppRealtimeEnvelope) => Promise<InAppPublishResult>

export type SendInAppProviderOptions = {
  publish: InAppPublisher
}

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim()

  if (!normalized) {
    throw new Error(`sendInApp: missing ${fieldName}`)
  }

  return normalized
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function buildEnvelope(request: InAppProviderSendRequest): InAppRealtimeEnvelope {
  return {
    kind: 'notification.in_app',
    deliveryId: normalizeRequiredString(request.deliveryId, 'deliveryId'),
    dispatchId: normalizeRequiredString(request.dispatchId, 'dispatchId'),
    recipientInAppTargetId: normalizeRequiredString(
      request.destination,
      'destination',
    ),
    idempotencyKey: normalizeRequiredString(
      request.idempotencyKey,
      'idempotencyKey',
    ),
    content: {
      title: request.content.title,
      body: request.content.body,
      href: request.content.href,
      templateKey: request.content.templateKey,
      templateVersion: request.content.templateVersion,
    },
    ...(request.metadata !== undefined ? { metadata: request.metadata } : {}),
  }
}

function buildConfigurationFailure(message: string): ProviderSendResult {
  return {
    ok: false,
    retryable: false,
    code: 'IN_APP_PROVIDER_MISCONFIGURED',
    message,
    providerStatus: 'misconfigured',
    responseMeta: {
      source: 'sendInApp',
    },
  }
}

function buildRejectedResult(
  publishResult: InAppPublishResult,
): ProviderSendResult {
  return {
    ok: false,
    retryable: true,
    code: 'IN_APP_PUBLISH_REJECTED',
    message: 'In-app realtime publish was rejected.',
    providerStatus: normalizeOptionalString(publishResult.providerStatus) ?? 'rejected',
    responseMeta:
      publishResult.responseMeta === undefined ? null : publishResult.responseMeta,
  }
}

function buildThrownFailure(error: unknown): ProviderSendResult {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'Unknown in-app publish error.'

  return {
    ok: false,
    retryable: true,
    code: 'IN_APP_PUBLISH_ERROR',
    message,
    providerStatus: 'error',
    responseMeta: {
      source: 'sendInApp',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    },
  }
}

export class InAppDeliveryProvider
  implements NotificationDeliveryProvider<InAppProviderSendRequest>
{
  readonly provider = NotificationProvider.INTERNAL_REALTIME
  readonly channel = NotificationChannel.IN_APP

  private readonly publish: InAppPublisher

  constructor(options: SendInAppProviderOptions) {
    if (typeof options.publish !== 'function') {
      throw new Error('sendInApp: publish must be a function')
    }

    this.publish = options.publish
  }

  async send(request: InAppProviderSendRequest): Promise<ProviderSendResult> {
    if (request.provider !== NotificationProvider.INTERNAL_REALTIME) {
      return buildConfigurationFailure(
        'Expected INTERNAL_REALTIME provider for in-app delivery.',
      )
    }

    if (request.channel !== NotificationChannel.IN_APP) {
      return buildConfigurationFailure(
        'Expected IN_APP channel for in-app delivery.',
      )
    }

    let envelope: InAppRealtimeEnvelope

    try {
      envelope = buildEnvelope(request)
    } catch (error) {
      return {
        ok: false,
        retryable: false,
        code: 'IN_APP_REQUEST_INVALID',
        message:
          error instanceof Error ? error.message : 'Invalid in-app send request.',
        providerStatus: 'invalid_request',
        responseMeta: {
          source: 'sendInApp',
        },
      }
    }

    try {
      const publishResult = await this.publish(envelope)

      if (!publishResult.accepted) {
        return buildRejectedResult(publishResult)
      }

      return {
        ok: true,
        providerMessageId:
          normalizeOptionalString(publishResult.providerMessageId) ??
          envelope.idempotencyKey,
        providerStatus:
          normalizeOptionalString(publishResult.providerStatus) ?? 'accepted',
        responseMeta:
          publishResult.responseMeta === undefined
            ? {
                source: 'sendInApp',
              }
            : publishResult.responseMeta,
      }
    } catch (error) {
      return buildThrownFailure(error)
    }
  }
}

export function createInAppDeliveryProvider(
  options: SendInAppProviderOptions,
): InAppDeliveryProvider {
  return new InAppDeliveryProvider(options)
}