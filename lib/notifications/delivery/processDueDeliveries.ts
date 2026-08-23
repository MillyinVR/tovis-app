// lib/notifications/delivery/processDueDeliveries.ts

import {
  ContactMethod,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationProvider,
} from '@prisma/client'

import {
  getNotificationEventDefinition,
  type NotificationTemplateKey,
} from '../eventKeys'
import {
  resolveBookingCalendarLinks,
  type BookingCalendarLinks,
} from '@/lib/calendar/bookingInvite'
import { appendClaimChannelParams } from '@/lib/clients/claimLinkChannel'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { getOrCreateShortLink, buildShortLinkUrl } from '@/lib/shortLink/shortLinkService'
import {
  claimDeliveries,
  type ClaimDeliveriesArgs,
  type ClaimedNotificationDelivery,
} from './claimDeliveries'
import { completeDeliveryAttempt } from './completeDeliveryAttempt'
import {
  buildProviderSendRequest,
  getRetryDelayMs,
} from './providerPolicy'
import type { TenantContext } from '@/lib/tenant/context'

import { renderNotificationContent } from './renderNotificationContent'
import {
  type EmailProviderSendRequest,
  type InAppProviderSendRequest,
  type NotificationDeliveryProvider,
  type ProviderSendRequest,
  type ProviderSendResult,
  type PushProviderSendRequest,
  type SmsProviderSendRequest,
} from './providerTypes'


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
  inApp: NotificationDeliveryProvider<InAppProviderSendRequest>
  // SMS/email providers are present only when their upstream credentials are
  // configured (see app/api/internal/jobs/notifications/process/route.ts). A
  // null entry means the channel has no live provider — its deliveries stay
  // claimable for a later run instead of crashing the whole worker. In-app
  // always exists, so in-app delivery never depends on SMS/email config.
  sms: NotificationDeliveryProvider<SmsProviderSendRequest> | null
  email: NotificationDeliveryProvider<EmailProviderSendRequest> | null
  // PUSH providers, present only when their upstream credentials are configured.
  // A single PushProviderSendRequest carries APNS|FCM, so each provider here only
  // handles the requests for its own provider value (routed in sendWithProvider).
  // Null until PR2b ships the real APNs/FCM clients → all PUSH rows stay claimable
  // (and in PR2a none are ever created, since the push capability gate is off).
  apns: NotificationDeliveryProvider<PushProviderSendRequest> | null
  fcm: NotificationDeliveryProvider<PushProviderSendRequest> | null
}

function normalizeNow(value: Date | undefined): Date {
  const now = value ?? new Date()

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('processDueDeliveries: invalid now')
  }

  return now
}

function normalizeErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof Error)) {
    return fallback
  }

  const message = error.message.trim()
  return message.length > 0 ? message : fallback
}

function getTemplateKeyForDelivery(
  delivery: ClaimedNotificationDelivery,
): NotificationTemplateKey {
  const expectedTemplateKey = getNotificationEventDefinition(
    delivery.dispatch.eventKey,
  ).templateKey

  if (delivery.templateKey !== expectedTemplateKey) {
    throw new Error(
      `processDueDeliveries: delivery templateKey ${delivery.templateKey} does not match event ${delivery.dispatch.eventKey} (${expectedTemplateKey})`,
    )
  }

  return expectedTemplateKey
}

function buildNextAttemptAt(args: {
  attemptedAt: Date
  nextAttemptCount: number
}): Date {
  return new Date(
    args.attemptedAt.getTime() + getRetryDelayMs(args.nextAttemptCount),
  )
}

function hasRetryAttemptsRemaining(
  delivery: ClaimedNotificationDelivery,
): boolean {
  return delivery.attemptCount < delivery.maxAttempts - 1
}

// Booking notifications whose email/SMS should carry an "Add to calendar" link.
const CALENDAR_LINK_TEMPLATE_KEYS: ReadonlySet<NotificationTemplateKey> = new Set([
  'booking_confirmed',
  'booking_rescheduled',
  'appointment_reminder',
  'client_claim_invite',
])

function readBookingIdFromPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const value = payload.bookingId
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * The underlying ClientActionToken's expiry, when the dispatch payload carries
 * one (aftercare/deposit/consultation/consent all stamp `expiresAt` onto their
 * payload at mint time — see each createXDelivery). Used to align the SHORT
 * LINK's own expiry to its destination's, so a dead token starts refusing
 * quickly instead of the short code outliving what it points to. The
 * destination route re-checks its own token expiry independently regardless —
 * this only bounds how long the short link ITSELF resolves. Null (no expiry)
 * for templates whose href isn't a token — e.g. the login-gated booking page —
 * which is the correct behavior for content that doesn't expire either.
 */
function readExpiresAtFromPayload(payload: unknown): Date | null {
  if (!isRecord(payload)) return null
  const value = payload.expiresAt
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * For email/SMS deliveries of appointment notifications, resolve the "Add to
 * calendar" links from the payload's bookingId. Best-effort: returns null (link
 * omitted) for other channels, non-calendar templates, or any resolution miss —
 * never throws, so it can't fail a delivery.
 */
async function resolveDeliveryCalendarLinks(
  delivery: ClaimedNotificationDelivery,
): Promise<BookingCalendarLinks | null> {
  if (
    delivery.channel !== NotificationChannel.EMAIL &&
    delivery.channel !== NotificationChannel.SMS
  ) {
    return null
  }

  if (!CALENDAR_LINK_TEMPLATE_KEYS.has(getTemplateKeyForDelivery(delivery))) {
    return null
  }

  const bookingId = readBookingIdFromPayload(delivery.dispatch.payload)
  if (!bookingId) return null

  return resolveBookingCalendarLinks(bookingId)
}

/**
 * Path (pathname + search) of an absolute same-origin app URL. `calendarLinks
 * .icsUrl` is always `${appOrigin}${path}` (lib/calendar/bookingInvite.ts), so
 * re-parsing it back apart is safe — it is never attacker-influenced.
 */
function pathFromAbsoluteAppUrl(absoluteUrl: string): string | null {
  try {
    const parsed = new URL(absoluteUrl)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return null
  }
}

/**
 * Best-effort: mint (or reuse) short links for the SMS-bound href and, when
 * present, the calendar link — logging and falling back to the un-shortened
 * URL on any failure rather than blocking the send. Only SMS gets these; every
 * other channel keeps using the full app link untouched. Exported so tests can
 * exercise this directly against a mocked lib/shortLink/shortLinkService
 * rather than through the full claim/render/send pipeline.
 */
export async function resolveSmsLinkOverrides(args: {
  delivery: ClaimedNotificationDelivery
  calendarLinks: BookingCalendarLinks | null
  /** Channel-resolved href to shorten; defaults to the dispatch's stored href. */
  href?: string | null
}): Promise<{ smsHref: string | null; smsCalendarUrl: string | null }> {
  if (args.delivery.channel !== NotificationChannel.SMS) {
    return { smsHref: null, smsCalendarUrl: null }
  }

  let smsHref: string | null = null
  try {
    const link = await getOrCreateShortLink({
      destinationPath: args.href ?? args.delivery.dispatch.href,
      createdForType: 'notification_dispatch_href',
      createdForId: args.delivery.dispatch.id,
      expiresAt: readExpiresAtFromPayload(args.delivery.dispatch.payload),
    })
    smsHref = buildShortLinkUrl(link.code)
  } catch (error) {
    console.error('processDueDeliveries: short link mint failed for href', {
      dispatchId: args.delivery.dispatch.id,
      error,
    })
  }

  let smsCalendarUrl: string | null = null
  const icsUrl = args.calendarLinks?.icsUrl ?? null
  if (icsUrl) {
    const calendarPath = pathFromAbsoluteAppUrl(icsUrl)
    if (calendarPath) {
      try {
        const link = await getOrCreateShortLink({
          destinationPath: calendarPath,
          createdForType: 'notification_dispatch_calendar',
          createdForId: args.delivery.dispatch.id,
        })
        smsCalendarUrl = buildShortLinkUrl(link.code)
      } catch (error) {
        console.error(
          'processDueDeliveries: short link mint failed for calendar link',
          { dispatchId: args.delivery.dispatch.id, error },
        )
      }
    }
  }

  return { smsHref, smsCalendarUrl }
}

/**
 * Whether this destination phone has never received a SENT/DELIVERED SMS from
 * the notification engine before — the CTIA opt-out disclosure
 * (lib/transactionalSmsPolicy.buildSmsOptOutDisclosureSuffix) is appended only
 * on this first send (see renderNotificationContent's sms() renderer), so
 * later sends to an already-notified recipient keep their single-segment
 * budget. Exported so tests can exercise it directly against a mocked
 * lib/prisma rather than through the full claim/render/send pipeline. Always
 * false for a non-SMS delivery or a destination-less row — neither needs the
 * lookup.
 */
export async function resolveIsFirstSmsToDestination(
  delivery: ClaimedNotificationDelivery,
): Promise<boolean> {
  if (delivery.channel !== NotificationChannel.SMS || !delivery.destination) {
    return false
  }

  const priorSend = await prisma.notificationDelivery.findFirst({
    where: {
      channel: NotificationChannel.SMS,
      destination: delivery.destination,
      status: {
        in: [NotificationDeliveryStatus.SENT, NotificationDeliveryStatus.DELIVERED],
      },
    },
    select: { id: true },
  })

  return priorSend === null
}

/**
 * The delivery channel a href is about to travel on, as a contact method —
 * null for channels (in-app/push) that never leave the app.
 */
function contactMethodForDeliveryChannel(
  channel: NotificationChannel,
): ContactMethod | null {
  if (channel === NotificationChannel.EMAIL) return ContactMethod.EMAIL
  if (channel === NotificationChannel.SMS) return ContactMethod.SMS
  return null
}

async function buildProviderRequest(
  delivery: ClaimedNotificationDelivery,
  tenantContext: TenantContext,
  calendarLinks: BookingCalendarLinks | null,
): Promise<ProviderSendRequest> {
  // Claim links get stamped with the channel carrying them (a signed
  // `via=email|sms`), so the click can count as verification of that contact.
  // Applied before short-link minting so the SMS short link redirects to the
  // stamped destination; every non-claim href passes through unchanged.
  const channelHref = appendClaimChannelParams(
    delivery.dispatch.href,
    contactMethodForDeliveryChannel(delivery.channel),
  )

  const [{ smsHref, smsCalendarUrl }, isFirstSmsToDestination] =
    await Promise.all([
      resolveSmsLinkOverrides({ delivery, calendarLinks, href: channelHref }),
      resolveIsFirstSmsToDestination(delivery),
    ])

  const content = renderNotificationContent({
    channel: delivery.channel,
    templateKey: getTemplateKeyForDelivery(delivery),
    templateVersion: delivery.templateVersion,
    tenantContext,
    dispatch: {
      eventKey: delivery.dispatch.eventKey,
      title: delivery.dispatch.title,
      body: delivery.dispatch.body,
      href: channelHref,
      payload: delivery.dispatch.payload,
      calendarLinks,
      smsHref,
      smsCalendarUrl,
      isFirstSmsToDestination,
    },
  })

  const request = buildProviderSendRequest({
    deliveryId: delivery.id,
    dispatchId: delivery.dispatch.id,
    destination: delivery.destination ?? '',
    attemptCount: delivery.attemptCount,
    content,
    // PUSH rows carry their per-device provider (APNS|FCM) on the row; pass it
    // through so the request routes to the right provider. Ignored for other
    // channels whose provider is fixed by the channel binding.
    provider: delivery.provider,
    metadata: {
      source: 'processDueDeliveries',
      sourceKey: delivery.dispatch.sourceKey,
      eventKey: delivery.dispatch.eventKey,
      channel: delivery.channel,
      provider: delivery.provider,
    },
  })

  if (request.channel !== delivery.channel) {
    throw new Error(
      `processDueDeliveries: provider request channel ${request.channel} does not match delivery channel ${delivery.channel}`,
    )
  }

  if (request.provider !== delivery.provider) {
    throw new Error(
      `processDueDeliveries: provider request provider ${request.provider} does not match delivery provider ${delivery.provider}`,
    )
  }

  return request
}

function buildProviderUnavailableResult(args: {
  provider: NotificationProvider
  channel: NotificationChannel
}): ProviderSendResult {
  // Retryable (not final): the credentials may arrive on a later run, so keep the
  // delivery claimable rather than burning it. The Twilio launch gate already
  // suppresses SMS at enqueue when unconfigured, so this is the safety net for
  // rows enqueued before a provider was turned off / not yet turned on.
  return {
    ok: false,
    retryable: true,
    code: 'PROVIDER_NOT_CONFIGURED',
    message: `No delivery provider is configured for channel ${args.channel}.`,
    providerStatus: 'provider_unavailable',
    responseMeta: {
      source: 'processDueDeliveries',
      provider: args.provider,
      channel: args.channel,
    },
  }
}

async function sendWithProvider(args: {
  request: ProviderSendRequest
  providers: DeliveryProviderRegistry
}): Promise<ProviderSendResult> {
  const { provider, channel } = args.request
  const { inApp, sms, email, apns, fcm } = args.providers

  switch (provider) {
    case NotificationProvider.INTERNAL_REALTIME:
      return inApp.send(args.request)

    case NotificationProvider.TWILIO:
      return sms
        ? sms.send(args.request)
        : buildProviderUnavailableResult({ provider, channel })

    case NotificationProvider.POSTMARK:
      return email
        ? email.send(args.request)
        : buildProviderUnavailableResult({ provider, channel })

    case NotificationProvider.APNS:
      return apns
        ? apns.send(args.request)
        : buildProviderUnavailableResult({ provider, channel })

    case NotificationProvider.FCM:
      return fcm
        ? fcm.send(args.request)
        : buildProviderUnavailableResult({ provider, channel })
  }

  throw new Error(
    `processDueDeliveries: unsupported provider ${provider} for channel ${channel}`,
  )
}
// An orchestration/render error (a missing env var, a template renderer throw,
// a transient DB hiccup) is almost always transient or operator-fixable — it
// must NOT permanently drop a critical delivery the way a hard provider reject
// does. So reschedule with backoff while the retry budget remains, giving an
// operator time to fix the config before the message is given up on; only
// finalize once attempts are exhausted. Either way the result is tagged
// ORCHESTRATION_ERROR for telemetry; the retry path is also counted as a
// scheduled retry.
async function handleOrchestrationFailure(args: {
  delivery: ClaimedNotificationDelivery
  leaseToken: string
  attemptedAt: Date
  message: string
}): Promise<ProcessedDeliveryOutcome> {
  const base = {
    deliveryId: args.delivery.id,
    provider: args.delivery.provider,
    channel: args.delivery.channel,
  }

  const responseMeta = {
    source: 'processDueDeliveries',
    provider: args.delivery.provider,
    channel: args.delivery.channel,
  }

  if (hasRetryAttemptsRemaining(args.delivery)) {
    const nextAttemptAt = buildNextAttemptAt({
      attemptedAt: args.attemptedAt,
      nextAttemptCount: args.delivery.attemptCount + 1,
    })

    try {
      await completeDeliveryAttempt({
        kind: 'RETRYABLE_FAILURE',
        deliveryId: args.delivery.id,
        leaseToken: args.leaseToken,
        attemptedAt: args.attemptedAt,
        nextAttemptAt,
        code: 'DELIVERY_ORCHESTRATION_ERROR',
        message: args.message,
        providerStatus: 'orchestration_error',
        responseMeta,
      })

      return { ...base, result: 'RETRY_SCHEDULED', nextAttemptAt }
    } catch (finalizeError) {
      // Even recording the retry failed (e.g. the same DB outage). Leave the row
      // untouched — its lease expires and a later drain reclaims it, so the
      // delivery is still not lost.
      const finalizeMessage = normalizeErrorMessage(
        finalizeError,
        'Unknown delivery finalization error.',
      )

      return {
        ...base,
        result: 'ORCHESTRATION_ERROR',
        message: `${args.message} Retry scheduling also failed: ${finalizeMessage}`,
      }
    }
  }

  // Retry budget exhausted — finalize as a permanent failure.
  try {
    await completeDeliveryAttempt({
      kind: 'FINAL_FAILURE',
      deliveryId: args.delivery.id,
      leaseToken: args.leaseToken,
      attemptedAt: args.attemptedAt,
      code: 'DELIVERY_ORCHESTRATION_ERROR',
      message: args.message,
      providerStatus: 'orchestration_error',
      responseMeta,
    })

    return { ...base, result: 'ORCHESTRATION_ERROR', message: args.message }
  } catch (finalizeError) {
    const finalizeMessage = normalizeErrorMessage(
      finalizeError,
      'Unknown delivery finalization error.',
    )

    return {
      ...base,
      result: 'ORCHESTRATION_ERROR',
      message: `${args.message} Finalization also failed: ${finalizeMessage}`,
    }
  }
}

async function finalizeSendResult(args: {
  delivery: ClaimedNotificationDelivery
  leaseToken: string
  attemptedAt: Date
  sendResult: ProviderSendResult
}): Promise<ProcessedDeliveryOutcome> {
  if (args.sendResult.ok) {
    await completeDeliveryAttempt({
      kind: 'SUCCESS',
      deliveryId: args.delivery.id,
      leaseToken: args.leaseToken,
      attemptedAt: args.attemptedAt,
      providerMessageId: args.sendResult.providerMessageId,
      providerStatus: args.sendResult.providerStatus,
      responseMeta: args.sendResult.responseMeta,
    })

    return {
      deliveryId: args.delivery.id,
      provider: args.delivery.provider,
      channel: args.delivery.channel,
      result: 'SENT',
    }
  }

  if (args.sendResult.retryable && hasRetryAttemptsRemaining(args.delivery)) {
    const nextAttemptAt = buildNextAttemptAt({
      attemptedAt: args.attemptedAt,
      nextAttemptCount: args.delivery.attemptCount + 1,
    })

    await completeDeliveryAttempt({
      kind: 'RETRYABLE_FAILURE',
      deliveryId: args.delivery.id,
      leaseToken: args.leaseToken,
      attemptedAt: args.attemptedAt,
      nextAttemptAt,
      code: args.sendResult.code,
      message: args.sendResult.message,
      providerStatus: args.sendResult.providerStatus,
      responseMeta: args.sendResult.responseMeta,
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
    leaseToken: args.leaseToken,
    attemptedAt: args.attemptedAt,
    code: args.sendResult.code,
    message: args.sendResult.message,
    providerStatus: args.sendResult.providerStatus,
    responseMeta: args.sendResult.responseMeta,
  })

  return {
    deliveryId: args.delivery.id,
    provider: args.delivery.provider,
    channel: args.delivery.channel,
    result: 'FAILED_FINAL',
  }
}

async function processClaimedDelivery(args: {
  delivery: ClaimedNotificationDelivery
  providers: DeliveryProviderRegistry
  tenantContext: TenantContext
  now: Date
}): Promise<ProcessedDeliveryOutcome> {
  const leaseToken = args.delivery.leaseToken

  if (!leaseToken) {
    return {
      deliveryId: args.delivery.id,
      provider: args.delivery.provider,
      channel: args.delivery.channel,
      result: 'ORCHESTRATION_ERROR',
      message:
        'Claimed delivery is missing leaseToken. Delivery could not be finalized because lease ownership is required.',
    }
  }

  try {
    const calendarLinks = await resolveDeliveryCalendarLinks(args.delivery)
    const request = await buildProviderRequest(
      args.delivery,
      args.tenantContext,
      calendarLinks,
    )
    const sendResult = await sendWithProvider({
      request,
      providers: args.providers,
    })

    return finalizeSendResult({
      delivery: args.delivery,
      leaseToken,
      attemptedAt: args.now,
      sendResult,
    })
  } catch (error) {
    const message = normalizeErrorMessage(
      error,
      'Unknown orchestration error.',
    )

    return handleOrchestrationFailure({
      delivery: args.delivery,
      leaseToken,
      attemptedAt: args.now,
      message,
    })
  }
}

function buildResultSummary(args: {
  claimedCount: number
  outcomes: ProcessedDeliveryOutcome[]
}): ProcessDueDeliveriesResult {
  let sentCount = 0
  let retryScheduledCount = 0
  let finalFailureCount = 0
  let orchestrationErrorCount = 0

  for (const outcome of args.outcomes) {
    switch (outcome.result) {
      case 'SENT':
        sentCount += 1
        break

      case 'RETRY_SCHEDULED':
        retryScheduledCount += 1
        break

      case 'FAILED_FINAL':
        finalFailureCount += 1
        break

      case 'ORCHESTRATION_ERROR':
        orchestrationErrorCount += 1
        break
    }
  }

  return {
    claimedCount: args.claimedCount,
    processedCount: args.outcomes.length,
    sentCount,
    retryScheduledCount,
    finalFailureCount,
    orchestrationErrorCount,
    outcomes: args.outcomes,
  }
}

export async function processDueDeliveries(args: {
  providers: DeliveryProviderRegistry
  tenantContext: TenantContext
  claim?: ProcessDueDeliveriesArgs
}): Promise<ProcessDueDeliveriesResult> {
  const now = normalizeNow(args.claim?.now)

  const claimed = await claimDeliveries({
    ...args.claim,
    now,
  })

  const outcomes: ProcessedDeliveryOutcome[] = []

  for (const delivery of claimed.deliveries) {
    const outcome = await processClaimedDelivery({
      delivery,
      providers: args.providers,
      tenantContext: args.tenantContext,
      now,
    })

    outcomes.push(outcome)
  }

  return buildResultSummary({
    claimedCount: claimed.deliveries.length,
    outcomes,
  })
}