// lib/notifications/delivery/sendPush.ts
//
// Real APNs (iOS) + FCM (Android) push delivery providers. Mirrors sendSms.ts:
// each is a NotificationDeliveryProvider<PushProviderSendRequest> that validates
// provider/channel, honors the load-test suppression hook, calls the underlying
// transport, and returns a ProviderSendResult with the standard retryable/final
// failure classification. A dead device token (the provider says the install can
// no longer receive pushes) deactivates the token via invalidateDeviceToken so we
// stop sending to it.

import {
  ApnsClient,
  ApnsError,
  Errors,
  Host,
  Notification,
} from 'apns2'
import { GoogleAuth } from 'google-auth-library'
import { NotificationChannel, NotificationProvider } from '@prisma/client'

import { asTrimmedString } from '@/lib/guards'
import {
  LOAD_TEST_SUPPRESSED_STATUS,
  realDeliverySuppressed,
} from '@/lib/loadTestDelivery'
import {
  requireApnsConfig,
  requireFcmConfig,
  type ApnsConfig,
  type FcmConfig,
  type FcmServiceAccount,
} from '@/lib/notifications/config'
import { invalidateDeviceToken } from '@/lib/notifications/devices/deviceTokens'
import { mapProviderSendFailureToDeliveryTransition } from '@/lib/notifications/providerStatus'

import {
  type NotificationDeliveryProvider,
  type ProviderSendResult,
  type PushProviderSendRequest,
} from './providerTypes'

type PushFailureKind = 'FAILED_RETRYABLE' | 'FAILED_FINAL'

function buildPushConfigurationFailure(
  source: string,
  message: string,
): ProviderSendResult {
  const transition = mapProviderSendFailureToDeliveryTransition('FAILED_FINAL')

  return {
    ok: false,
    retryable: false,
    code: 'PUSH_PROVIDER_MISCONFIGURED',
    message,
    providerStatus: 'misconfigured',
    responseMeta: {
      source,
      nextStatus: transition.nextStatus,
      eventType: transition.eventType,
    },
  }
}

function buildPushRequestFailure(
  source: string,
  message: string,
): ProviderSendResult {
  const transition = mapProviderSendFailureToDeliveryTransition('FAILED_FINAL')

  return {
    ok: false,
    retryable: false,
    code: 'PUSH_REQUEST_INVALID',
    message,
    providerStatus: 'invalid_request',
    responseMeta: {
      source,
      nextStatus: transition.nextStatus,
      eventType: transition.eventType,
    },
  }
}

function buildPushFailure(args: {
  source: string
  kind: PushFailureKind
  code: string
  message: string
  extraMeta?: Record<string, string | number | null>
}): ProviderSendResult {
  const transition = mapProviderSendFailureToDeliveryTransition(args.kind)

  return {
    ok: false,
    retryable: args.kind === 'FAILED_RETRYABLE',
    code: args.code,
    message: args.message,
    providerStatus:
      args.kind === 'FAILED_RETRYABLE' ? 'retryable_error' : 'failed',
    responseMeta: {
      source: args.source,
      ...(args.extraMeta ?? {}),
      nextStatus: transition.nextStatus,
      eventType: transition.eventType,
    },
  }
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }

  return fallback
}

// ---------------------------------------------------------------------------
// APNs
// ---------------------------------------------------------------------------

const APNS_SOURCE = 'sendPush.apns'

// Reasons (the APNs `reason` string) that mean the token is permanently dead and
// must be deactivated so we stop targeting it.
const APNS_DEAD_TOKEN_REASONS: ReadonlySet<string> = new Set([
  Errors.badDeviceToken,
  Errors.unregistered,
  Errors.deviceTokenNotForTopic,
  Errors.missingDeviceToken,
])

// Reasons that are transient — the same notification can succeed on retry.
const APNS_RETRYABLE_REASONS: ReadonlySet<string> = new Set([
  Errors.tooManyRequests,
  Errors.serviceUnavailable,
  Errors.internalServerError,
  Errors.idleTimeout,
  Errors.expiredProviderToken,
  Errors.shutdown,
])

export type ApnsSendClient = {
  send(notification: Notification): Promise<unknown>
}

export type SendApnsProviderOptions = {
  client?: ApnsSendClient
  config?: ApnsConfig
}

function createApnsClientFromConfig(config: ApnsConfig): ApnsSendClient {
  return new ApnsClient({
    team: config.teamId,
    keyId: config.keyId,
    signingKey: config.authKey,
    defaultTopic: config.bundleId,
    host: config.production ? Host.production : Host.development,
  })
}

export class ApnsDeliveryProvider
  implements NotificationDeliveryProvider<PushProviderSendRequest>
{
  readonly provider = NotificationProvider.APNS
  readonly channel = NotificationChannel.PUSH

  private readonly bundleId: string
  private readonly injectedClient: ApnsSendClient | null
  private readonly resolveConfig: (() => ApnsConfig) | null
  private client: ApnsSendClient | null

  constructor(options: SendApnsProviderOptions = {}) {
    if (options.client) {
      // Injected (tests): config is optional; only the topic (bundleId) is
      // needed and may be supplied via config or defaulted.
      this.injectedClient = options.client
      this.client = options.client
      this.bundleId = options.config?.bundleId ?? ''
      this.resolveConfig = null
      return
    }

    // Lazy: don't read config / build the http2 client until first send, so an
    // unconfigured provider can be constructed inertly.
    this.injectedClient = null
    this.client = null
    this.bundleId = options.config?.bundleId ?? ''
    this.resolveConfig = () => options.config ?? requireApnsConfig()
  }

  private getClientAndTopic(): { client: ApnsSendClient; topic: string } {
    if (this.injectedClient) {
      return { client: this.injectedClient, topic: this.bundleId }
    }

    if (!this.resolveConfig) {
      throw new Error('sendPush.apns: provider is not configured')
    }

    const config = this.resolveConfig()

    if (!this.client) {
      this.client = createApnsClientFromConfig(config)
    }

    return { client: this.client, topic: config.bundleId }
  }

  async send(request: PushProviderSendRequest): Promise<ProviderSendResult> {
    if (request.provider !== NotificationProvider.APNS) {
      return buildPushConfigurationFailure(
        APNS_SOURCE,
        'Expected APNS provider for APNs delivery.',
      )
    }

    if (request.channel !== NotificationChannel.PUSH) {
      return buildPushConfigurationFailure(
        APNS_SOURCE,
        'Expected PUSH channel for APNs delivery.',
      )
    }

    if (realDeliverySuppressed()) {
      return {
        ok: true,
        providerMessageId: request.idempotencyKey,
        providerStatus: LOAD_TEST_SUPPRESSED_STATUS,
        responseMeta: { source: APNS_SOURCE, suppressed: true },
      }
    }

    const destination = asTrimmedString(request.destination)
    if (!destination) {
      return buildPushRequestFailure(
        APNS_SOURCE,
        'sendPush.apns: missing destination',
      )
    }

    let client: ApnsSendClient
    let topic: string

    try {
      const resolved = this.getClientAndTopic()
      client = resolved.client
      topic = resolved.topic
    } catch (error) {
      return buildPushConfigurationFailure(
        APNS_SOURCE,
        readErrorMessage(error, 'sendPush.apns: provider is not configured'),
      )
    }

    const href = asTrimmedString(request.content.href)

    const notification = new Notification(destination, {
      alert: { title: request.content.title, body: request.content.body },
      topic,
      data: href ? { href } : undefined,
    })

    try {
      await client.send(notification)

      return {
        ok: true,
        providerMessageId: request.idempotencyKey,
        providerStatus: 'sent',
        responseMeta: { source: APNS_SOURCE, topic },
      }
    } catch (error) {
      if (error instanceof ApnsError) {
        const reason = asTrimmedString(error.reason) ?? 'UnknownError'

        if (APNS_DEAD_TOKEN_REASONS.has(reason)) {
          await invalidateDeviceToken({
            platform: 'IOS',
            token: destination,
          })

          return buildPushFailure({
            source: APNS_SOURCE,
            kind: 'FAILED_FINAL',
            code: reason,
            message: readErrorMessage(error, reason),
            extraMeta: {
              reason,
              statusCode: error.statusCode,
              invalidatedToken: 1,
            },
          })
        }

        const kind: PushFailureKind = APNS_RETRYABLE_REASONS.has(reason)
          ? 'FAILED_RETRYABLE'
          : 'FAILED_FINAL'

        return buildPushFailure({
          source: APNS_SOURCE,
          kind,
          code: reason,
          message: readErrorMessage(error, reason),
          extraMeta: { reason, statusCode: error.statusCode },
        })
      }

      // Non-ApnsError (network/connection): treat as transient → retryable.
      return buildPushFailure({
        source: APNS_SOURCE,
        kind: 'FAILED_RETRYABLE',
        code: 'APNS_TRANSPORT_ERROR',
        message: readErrorMessage(error, 'APNs transport error.'),
        extraMeta: {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      })
    }
  }
}

export function createApnsDeliveryProvider(
  options: SendApnsProviderOptions = {},
): ApnsDeliveryProvider {
  // When no client is injected, eagerly require config so an unconfigured
  // provider surfaces a NotificationProviderConfigError (the registry builder
  // catches it and degrades to a null provider).
  if (!options.client && !options.config) {
    requireApnsConfig()
  }

  return new ApnsDeliveryProvider(options)
}

// ---------------------------------------------------------------------------
// FCM
// ---------------------------------------------------------------------------

const FCM_SOURCE = 'sendPush.fcm'

const FCM_MESSAGING_SCOPE =
  'https://www.googleapis.com/auth/firebase.messaging'

// FCM v1 error.status values that mean the token is permanently dead.
const FCM_DEAD_TOKEN_STATUSES: ReadonlySet<string> = new Set([
  'UNREGISTERED',
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'SENDER_ID_MISMATCH',
])

// FCM v1 error.status values that are transient → retryable.
const FCM_RETRYABLE_STATUSES: ReadonlySet<string> = new Set([
  'UNAVAILABLE',
  'INTERNAL',
  'QUOTA_EXCEEDED',
])

type FetchLike = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
  },
) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
}>

export type FcmAccessTokenProvider = () => Promise<string>

export type SendFcmProviderOptions = {
  config?: FcmConfig
  // Test seam: inject a fetch and a token provider so no network/auth happens.
  fetchImpl?: FetchLike
  getAccessToken?: FcmAccessTokenProvider
}

function buildGoogleAccessTokenProvider(
  serviceAccount: FcmServiceAccount,
): FcmAccessTokenProvider {
  let auth: GoogleAuth | null = null

  return async () => {
    if (!auth) {
      auth = new GoogleAuth({
        credentials: serviceAccount,
        scopes: [FCM_MESSAGING_SCOPE],
      })
    }

    const token = await auth.getAccessToken()
    const trimmed = asTrimmedString(token)

    if (!trimmed) {
      throw new Error('sendPush.fcm: failed to obtain an FCM access token')
    }

    return trimmed
  }
}

function readFcmErrorStatus(rawBody: string): {
  status: string | null
  message: string | null
} {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return { status: null, message: null }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { status: null, message: null }
  }

  const errorValue = (parsed as { error?: unknown }).error
  if (typeof errorValue !== 'object' || errorValue === null) {
    return { status: null, message: null }
  }

  const status = (errorValue as { status?: unknown }).status
  const message = (errorValue as { message?: unknown }).message

  return {
    status: typeof status === 'string' ? status : null,
    message: typeof message === 'string' ? message : null,
  }
}

function readFcmMessageName(rawBody: string): string | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const name = (parsed as { name?: unknown }).name
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

export class FcmDeliveryProvider
  implements NotificationDeliveryProvider<PushProviderSendRequest>
{
  readonly provider = NotificationProvider.FCM
  readonly channel = NotificationChannel.PUSH

  private readonly fetchImpl: FetchLike
  private readonly injectedTokenProvider: FcmAccessTokenProvider | null
  private readonly resolveConfig: (() => FcmConfig) | null
  private readonly directConfig: FcmConfig | null
  private tokenProvider: FcmAccessTokenProvider | null

  constructor(options: SendFcmProviderOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ??
      ((url, init) => fetch(url, init) as ReturnType<FetchLike>)

    this.injectedTokenProvider = options.getAccessToken ?? null
    this.tokenProvider = options.getAccessToken ?? null

    if (options.config) {
      this.directConfig = options.config
      this.resolveConfig = null
    } else {
      // Lazy: don't require config until first send.
      this.directConfig = null
      this.resolveConfig = () => requireFcmConfig()
    }
  }

  private resolve(): {
    projectId: string
    getAccessToken: FcmAccessTokenProvider
  } {
    if (this.directConfig) {
      if (!this.tokenProvider) {
        this.tokenProvider = buildGoogleAccessTokenProvider(
          this.directConfig.serviceAccount,
        )
      }

      return {
        projectId: this.directConfig.projectId,
        getAccessToken: this.tokenProvider,
      }
    }

    if (this.injectedTokenProvider && !this.resolveConfig) {
      throw new Error('sendPush.fcm: provider is not configured')
    }

    if (!this.resolveConfig) {
      throw new Error('sendPush.fcm: provider is not configured')
    }

    const config = this.resolveConfig()

    if (!this.tokenProvider) {
      this.tokenProvider = buildGoogleAccessTokenProvider(config.serviceAccount)
    }

    return { projectId: config.projectId, getAccessToken: this.tokenProvider }
  }

  async send(request: PushProviderSendRequest): Promise<ProviderSendResult> {
    if (request.provider !== NotificationProvider.FCM) {
      return buildPushConfigurationFailure(
        FCM_SOURCE,
        'Expected FCM provider for FCM delivery.',
      )
    }

    if (request.channel !== NotificationChannel.PUSH) {
      return buildPushConfigurationFailure(
        FCM_SOURCE,
        'Expected PUSH channel for FCM delivery.',
      )
    }

    if (realDeliverySuppressed()) {
      return {
        ok: true,
        providerMessageId: request.idempotencyKey,
        providerStatus: LOAD_TEST_SUPPRESSED_STATUS,
        responseMeta: { source: FCM_SOURCE, suppressed: true },
      }
    }

    const destination = asTrimmedString(request.destination)
    if (!destination) {
      return buildPushRequestFailure(
        FCM_SOURCE,
        'sendPush.fcm: missing destination',
      )
    }

    let projectId: string
    let getAccessToken: FcmAccessTokenProvider

    try {
      const resolved = this.resolve()
      projectId = resolved.projectId
      getAccessToken = resolved.getAccessToken
    } catch (error) {
      return buildPushConfigurationFailure(
        FCM_SOURCE,
        readErrorMessage(error, 'sendPush.fcm: provider is not configured'),
      )
    }

    const href = asTrimmedString(request.content.href)

    const body = JSON.stringify({
      message: {
        token: destination,
        notification: {
          title: request.content.title,
          body: request.content.body,
        },
        ...(href ? { data: { href } } : {}),
      },
    })

    try {
      const accessToken = await getAccessToken()

      const response = await this.fetchImpl(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body,
        },
      )

      const rawBody = await response.text()

      if (response.ok) {
        return {
          ok: true,
          providerMessageId:
            readFcmMessageName(rawBody) ?? request.idempotencyKey,
          providerStatus: 'sent',
          responseMeta: { source: FCM_SOURCE, projectId },
        }
      }

      const { status, message } = readFcmErrorStatus(rawBody)
      const normalizedStatus = status ?? `HTTP_${response.status}`

      if (status && FCM_DEAD_TOKEN_STATUSES.has(status)) {
        await invalidateDeviceToken({
          platform: 'ANDROID',
          token: destination,
        })

        return buildPushFailure({
          source: FCM_SOURCE,
          kind: 'FAILED_FINAL',
          code: normalizedStatus,
          message: message ?? `FCM rejected the token (${normalizedStatus}).`,
          extraMeta: {
            status: normalizedStatus,
            httpStatus: response.status,
            invalidatedToken: 1,
          },
        })
      }

      const retryable =
        (status !== null && FCM_RETRYABLE_STATUSES.has(status)) ||
        response.status === 429 ||
        response.status >= 500

      return buildPushFailure({
        source: FCM_SOURCE,
        kind: retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
        code: normalizedStatus,
        message: message ?? `FCM send failed (${normalizedStatus}).`,
        extraMeta: { status: normalizedStatus, httpStatus: response.status },
      })
    } catch (error) {
      // Thrown / network / token-acquisition error: transient → retryable.
      return buildPushFailure({
        source: FCM_SOURCE,
        kind: 'FAILED_RETRYABLE',
        code: 'FCM_TRANSPORT_ERROR',
        message: readErrorMessage(error, 'FCM transport error.'),
        extraMeta: {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      })
    }
  }
}

export function createFcmDeliveryProvider(
  options: SendFcmProviderOptions = {},
): FcmDeliveryProvider {
  // When no config + token provider are injected, eagerly require config so an
  // unconfigured provider surfaces a NotificationProviderConfigError.
  if (!options.config && !options.getAccessToken) {
    requireFcmConfig()
  }

  return new FcmDeliveryProvider(options)
}
