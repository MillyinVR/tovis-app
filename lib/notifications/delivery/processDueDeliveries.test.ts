import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ContactMethod,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEventKey,
  NotificationPriority,
  NotificationProvider,
  NotificationRecipientKind,
  Prisma,
} from '@prisma/client'

import { verifyClaimLinkChannel } from '@/lib/clients/claimLinkChannel'
import { rootTenantContext } from '@/lib/tenant/context'
import { EmailDeliveryProvider } from './sendEmail'
import { InAppDeliveryProvider } from './sendInApp'
import { SmsDeliveryProvider } from './sendSms'

const mockClaimDeliveries = vi.hoisted(() => vi.fn())
const mockCompleteDeliveryAttempt = vi.hoisted(() => vi.fn())
const mockGetOrCreateShortLink = vi.hoisted(() => vi.fn())
const mockBuildShortLinkUrl = vi.hoisted(() => vi.fn())
const mockCaptureNotificationException = vi.hoisted(() => vi.fn())
const mockPrisma = vi.hoisted(() => ({
  notificationDelivery: {
    findFirst: vi.fn(),
  },
}))

vi.mock('./claimDeliveries', () => ({
  claimDeliveries: mockClaimDeliveries,
}))

vi.mock('./completeDeliveryAttempt', () => ({
  completeDeliveryAttempt: mockCompleteDeliveryAttempt,
}))

// Left resolving `null` by default (see beforeEach) — "no prior SENT/DELIVERED
// SMS to this destination" — so resolveIsFirstSmsToDestination defaults to
// true. No existing test in this file asserts the rendered SMS text, so that
// default doesn't affect them; tests that care configure it explicitly.
vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

// Left UNCONFIGURED by default (resolves to undefined) in most tests below —
// that makes resolveSmsLinkOverrides' own try/catch fall back to the
// un-shortened href, the same degrade-safely behavior a real short-link mint
// failure produces. Tests that care about the shortened path configure it
// explicitly.
//
// ShortLinkDestinationNotAllowedError is passed through from the REAL module,
// not stubbed: resolveSmsLinkOverrides narrows on it with `instanceof` to decide
// give-up-now vs retry-once, so a look-alike class would silently take the
// retry branch and this file would stop testing the thing it claims to.
vi.mock('@/lib/shortLink/shortLinkService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/shortLink/shortLinkService')>()

  return {
    getOrCreateShortLink: mockGetOrCreateShortLink,
    buildShortLinkUrl: mockBuildShortLinkUrl,
    ShortLinkDestinationNotAllowedError:
      actual.ShortLinkDestinationNotAllowedError,
  }
})

vi.mock('@/lib/observability/notificationEvents', () => ({
  captureNotificationException: mockCaptureNotificationException,
}))

import { ShortLinkDestinationNotAllowedError } from '@/lib/shortLink/shortLinkService'
import {
  processDueDeliveries,
  resolveIsFirstSmsToDestination,
  resolveSmsLinkOverrides,
} from './processDueDeliveries'

function makeClaimedDelivery(
  args: Partial<{
    id: string
    channel: NotificationChannel
    provider: NotificationProvider
    destination: string | null
    templateKey: string
    templateVersion: number
    attemptCount: number
    maxAttempts: number
    leaseToken: string | null
    status: NotificationDeliveryStatus
    eventKey: NotificationEventKey
  }> = {},
) {
  const now = new Date('2026-04-09T12:00:00.000Z')

  return {
    id: args.id ?? 'delivery_1',
    channel: args.channel ?? NotificationChannel.IN_APP,
    provider: args.provider ?? NotificationProvider.INTERNAL_REALTIME,
    status: args.status ?? NotificationDeliveryStatus.PENDING,
    destination: args.destination ?? 'client_1',
    templateKey: args.templateKey ?? 'booking_confirmed',
    templateVersion: args.templateVersion ?? 1,
    attemptCount: args.attemptCount ?? 0,
    maxAttempts: args.maxAttempts ?? 3,
    nextAttemptAt: now,
    lastAttemptAt: null,
    claimedAt: now,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    leaseToken:
      args.leaseToken === undefined ? 'lease_token_1' : args.leaseToken,
    providerMessageId: null,
    providerStatus: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    sentAt: null,
    deliveredAt: null,
    failedAt: null,
    suppressedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    dispatch: {
      id: 'dispatch_1',
      sourceKey: 'client-notification:notif_1',
      eventKey: args.eventKey ?? NotificationEventKey.BOOKING_CONFIRMED,
      recipientKind: NotificationRecipientKind.CLIENT,
      priority: NotificationPriority.NORMAL,
      userId: 'user_1',
      professionalId: null,
      clientId: 'client_1',
      recipientInAppTargetId: 'client_1',
      recipientPhone: '+15551234567',
      recipientEmail: 'client@example.com',
      recipientTimeZone: 'America/Los_Angeles',
      notificationId: null,
      clientNotificationId: 'notif_1',
      title: 'Appointment confirmed',
      body: 'Your appointment is confirmed.',
      href: '/client/bookings/booking_1',
      payload: {
        bookingId: 'booking_1',
      } as Prisma.JsonValue,
      scheduledFor: now,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    },
  }
}

function makeResponse(args: {
  ok: boolean
  status: number
  text: string
}): Response {
  return {
    ok: args.ok,
    status: args.status,
    text: vi.fn().mockResolvedValue(args.text),
  } as unknown as Response
}

function makeProviders() {
  const inApp = new InAppDeliveryProvider({
    publish: vi.fn().mockResolvedValue({
      accepted: true,
      providerMessageId: 'default_in_app_msg',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendInApp',
      },
    }),
  })

  const sms = new SmsDeliveryProvider({
    client: {
      messages: {
        create: vi.fn().mockResolvedValue({
          to: '+15551234567',
          body: 'default sms body',
          status: 'queued',
          sid: 'default_sms_sid',
        }),
      },
    },
    fromNumber: '+15550001111',
    statusCallbackUrl: null,
  })

  const email = new EmailDeliveryProvider({
    apiToken: 'postmark-token',
    fromEmail: 'hello@tovis.com',
    fetchImpl: vi.fn().mockResolvedValue(
      makeResponse({
        ok: true,
        status: 200,
        text: JSON.stringify({
          ErrorCode: 0,
          MessageID: 'default_email_msg',
          SubmittedAt: '2026-04-09T12:00:00Z',
          To: 'client@example.com',
        }),
      }),
    ),
  })

  const inAppSend = vi.spyOn(inApp, 'send')
  const smsSend = vi.spyOn(sms, 'send')
  const emailSend = vi.spyOn(email, 'send')

  return {
    providers: {
      inApp,
      sms,
      email,
      apns: null,
      fcm: null,
    },
    inAppSend,
    smsSend,
    emailSend,
  }
}

describe('lib/notifications/delivery/processDueDeliveries', () => {
  const originalAppUrl = process.env.APP_URL
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL

  beforeEach(() => {
    process.env.APP_URL = 'https://tovis.test'
    process.env.NEXT_PUBLIC_APP_URL = 'https://tovis.test'

    mockClaimDeliveries.mockReset()
    mockCompleteDeliveryAttempt.mockReset()
    mockCompleteDeliveryAttempt.mockResolvedValue(undefined)
    mockGetOrCreateShortLink.mockReset()
    mockBuildShortLinkUrl.mockReset()
    mockPrisma.notificationDelivery.findFirst.mockReset()
    mockPrisma.notificationDelivery.findFirst.mockResolvedValue(null)
  })

  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL
    } else {
      process.env.APP_URL = originalAppUrl
    }

    if (originalNextPublicAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl
    }
  })

  it('processes a successful in-app delivery', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend, smsSend, emailSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_in_app_1',
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          destination: 'client_1',
          attemptCount: 0,
          maxAttempts: 3,
        }),
      ],
    })

    inAppSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'realtime_msg_1',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendInApp',
      },
    })

    const result = await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: {
        now,
        batchSize: 10,
      },
    })

    expect(mockClaimDeliveries).toHaveBeenCalledWith({
      now,
      batchSize: 10,
    })

    expect(inAppSend).toHaveBeenCalledTimes(1)
    expect(smsSend).not.toHaveBeenCalled()
    expect(emailSend).not.toHaveBeenCalled()

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'SUCCESS',
      deliveryId: 'delivery_in_app_1',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      providerMessageId: 'realtime_msg_1',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendInApp',
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 1,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_in_app_1',
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          result: 'SENT',
        },
      ],
    })
  })

  it('processes a successful sms delivery through the sms provider', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend, smsSend, emailSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_sms_1',
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          destination: '+15551234567',
          templateKey: 'booking_confirmed',
          attemptCount: 0,
          maxAttempts: 5,
        }),
      ],
    })

    smsSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'SM123',
      providerStatus: 'queued',
      responseMeta: {
        source: 'sendSms',
      },
    })

    const result = await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    expect(inAppSend).not.toHaveBeenCalled()
    expect(smsSend).toHaveBeenCalledTimes(1)
    expect(emailSend).not.toHaveBeenCalled()

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'SUCCESS',
      deliveryId: 'delivery_sms_1',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      providerMessageId: 'SM123',
      providerStatus: 'queued',
      responseMeta: {
        source: 'sendSms',
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 1,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_sms_1',
          provider: NotificationProvider.TWILIO,
          channel: NotificationChannel.SMS,
          result: 'SENT',
        },
      ],
    })
  })

  // End-to-end wiring assertions: the renderer and the first-send resolver are
  // each unit-tested in isolation, but only these two prove processDueDeliveries
  // actually connects them — i.e. that the text handed to Twilio carries (or
  // omits) the opt-out disclosure. Wiring the flag to a wrong/renamed field
  // would leave every other test in this file green.
  it('sends the opt-out disclosure in the real SMS text on a first send to a destination', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, smsSend } = makeProviders()

    // No prior SENT/DELIVERED SMS for this destination → first send.
    mockPrisma.notificationDelivery.findFirst.mockResolvedValue(null)

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_sms_first',
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          destination: '+15551234567',
          templateKey: 'booking_confirmed',
        }),
      ],
    })

    smsSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'SM_first',
      providerStatus: 'queued',
      responseMeta: { source: 'sendSms' },
    })

    await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    expect(smsSend).toHaveBeenCalledTimes(1)
    const sentRequest = smsSend.mock.calls[0]?.[0]
    expect(sentRequest?.content).toMatchObject({
      channel: NotificationChannel.SMS,
    })
    expect(
      (sentRequest?.content as { text: string }).text,
    ).toContain('Reply STOP to opt out, HELP for help.')
  })

  it('omits the opt-out disclosure in the real SMS text once the destination has been texted before', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, smsSend } = makeProviders()

    // A prior SENT SMS exists for this destination → not a first send.
    mockPrisma.notificationDelivery.findFirst.mockResolvedValue({
      id: 'prior_delivery_1',
    })

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_sms_repeat',
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          destination: '+15551234567',
          templateKey: 'booking_confirmed',
        }),
      ],
    })

    smsSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'SM_repeat',
      providerStatus: 'queued',
      responseMeta: { source: 'sendSms' },
    })

    await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    expect(smsSend).toHaveBeenCalledTimes(1)
    const sentRequest = smsSend.mock.calls[0]?.[0]
    expect((sentRequest?.content as { text: string }).text).not.toContain(
      'Reply STOP',
    )
  })

  it('stamps a claim link with the EMAIL channel marker in the delivered email', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, emailSend } = makeProviders()

    const delivery = makeClaimedDelivery({
      id: 'delivery_claim_email',
      channel: NotificationChannel.EMAIL,
      provider: NotificationProvider.POSTMARK,
      destination: 'client@example.com',
      templateKey: 'client_claim_invite',
      eventKey: NotificationEventKey.CLIENT_CLAIM_INVITE,
    })
    delivery.dispatch.href = '/claim/rawtok_1'

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [delivery],
    })

    emailSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'email_claim',
      providerStatus: 'sent',
      responseMeta: { source: 'sendEmail' },
    })

    await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    const content = emailSend.mock.calls[0]?.[0]?.content as {
      text: string
      html: string
    }

    // The link the recipient actually receives carries a signature that
    // resolves to EMAIL — that is what lets the click count as verification.
    const match = /\/claim\/rawtok_1\?via=([^&\s]+)&vsig=([^\s"&<]+)/.exec(
      content.text,
    )
    expect(match).not.toBeNull()
    expect(
      verifyClaimLinkChannel({
        rawToken: 'rawtok_1',
        via: match?.[1] ?? null,
        sig: match?.[2] ?? null,
      }),
    ).toBe(ContactMethod.EMAIL)
    expect(content.html).toContain('via=email')
  })

  it('stamps the SMS copy of the same claim link with the SMS marker', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, smsSend } = makeProviders()

    const delivery = makeClaimedDelivery({
      id: 'delivery_claim_sms',
      channel: NotificationChannel.SMS,
      provider: NotificationProvider.TWILIO,
      destination: '+15551234567',
      templateKey: 'client_claim_invite',
      eventKey: NotificationEventKey.CLIENT_CLAIM_INVITE,
    })
    delivery.dispatch.href = '/claim/rawtok_1'

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [delivery],
    })

    // Short-link minting is what actually carries the stamped destination for
    // SMS, so assert on the path handed to it.
    mockGetOrCreateShortLink.mockResolvedValue({ code: 'Ab3xK9pQ' })
    mockBuildShortLinkUrl.mockReturnValue('https://tovis.me/s/Ab3xK9pQ')

    smsSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'SM_claim',
      providerStatus: 'queued',
      responseMeta: { source: 'sendSms' },
    })

    await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    const shortLinkArg = mockGetOrCreateShortLink.mock.calls[0]?.[0] as {
      destinationPath: string
    }
    const match = /\/claim\/rawtok_1\?via=([^&]+)&vsig=(.+)$/.exec(
      shortLinkArg.destinationPath,
    )
    expect(match).not.toBeNull()
    expect(
      verifyClaimLinkChannel({
        rawToken: 'rawtok_1',
        via: match?.[1] ?? null,
        sig: match?.[2] ?? null,
      }),
    ).toBe(ContactMethod.SMS)
  })

  it('leaves a non-claim href untouched by the channel stamp', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, emailSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_booking_email',
          channel: NotificationChannel.EMAIL,
          provider: NotificationProvider.POSTMARK,
          destination: 'client@example.com',
          templateKey: 'booking_confirmed',
        }),
      ],
    })

    emailSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'email_booking',
      providerStatus: 'sent',
      responseMeta: { source: 'sendEmail' },
    })

    await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    const content = emailSend.mock.calls[0]?.[0]?.content as { text: string }
    expect(content.text).toContain('/client/bookings/booking_1')
    expect(content.text).not.toContain('via=')
    expect(content.text).not.toContain('vsig=')
  })

  it('processes a successful email delivery through the email provider', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend, smsSend, emailSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_email_success',
          channel: NotificationChannel.EMAIL,
          provider: NotificationProvider.POSTMARK,
          destination: 'client@example.com',
          templateKey: 'booking_confirmed',
          attemptCount: 0,
          maxAttempts: 5,
        }),
      ],
    })

    emailSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'email_msg_1',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendEmail',
      },
    })

    const result = await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    expect(inAppSend).not.toHaveBeenCalled()
    expect(smsSend).not.toHaveBeenCalled()
    expect(emailSend).toHaveBeenCalledTimes(1)

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'SUCCESS',
      deliveryId: 'delivery_email_success',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      providerMessageId: 'email_msg_1',
      providerStatus: 'accepted',
      responseMeta: {
        source: 'sendEmail',
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 1,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_email_success',
          provider: NotificationProvider.POSTMARK,
          channel: NotificationChannel.EMAIL,
          result: 'SENT',
        },
      ],
    })
  })

  it('keeps an SMS delivery claimable (retryable) when the SMS provider is absent', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend, smsSend, emailSend } = makeProviders()

    // Simulate Twilio not being configured: the registry carries a null sms entry.
    const providersWithoutSms = { ...providers, sms: null }

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_sms_no_provider',
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          destination: '+15551234567',
          templateKey: 'booking_confirmed',
          attemptCount: 0,
          maxAttempts: 5,
        }),
      ],
    })

    const result = await processDueDeliveries({
      providers: providersWithoutSms,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    expect(inAppSend).not.toHaveBeenCalled()
    expect(smsSend).not.toHaveBeenCalled()
    expect(emailSend).not.toHaveBeenCalled()

    const expectedNextAttemptAt = new Date(now.getTime() + 60_000)

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'RETRYABLE_FAILURE',
      deliveryId: 'delivery_sms_no_provider',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      nextAttemptAt: expectedNextAttemptAt,
      code: 'PROVIDER_NOT_CONFIGURED',
      message: 'No delivery provider is configured for channel SMS.',
      providerStatus: 'provider_unavailable',
      responseMeta: {
        source: 'processDueDeliveries',
        provider: NotificationProvider.TWILIO,
        channel: NotificationChannel.SMS,
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 1,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_sms_no_provider',
          provider: NotificationProvider.TWILIO,
          channel: NotificationChannel.SMS,
          result: 'RETRY_SCHEDULED',
          nextAttemptAt: expectedNextAttemptAt,
        },
      ],
    })
  })

  it('still delivers in-app when SMS and email providers are both absent', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend } = makeProviders()

    const providersInAppOnly = { ...providers, sms: null, email: null }

    inAppSend.mockResolvedValue({
      ok: true,
      providerMessageId: 'realtime_msg_only',
      providerStatus: 'accepted',
      responseMeta: { source: 'sendInApp' },
    })

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_in_app_only',
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          destination: 'client_1',
        }),
      ],
    })

    const result = await processDueDeliveries({
      providers: providersInAppOnly,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    expect(inAppSend).toHaveBeenCalledTimes(1)
    expect(result.sentCount).toBe(1)
    expect(result.outcomes[0]).toEqual({
      deliveryId: 'delivery_in_app_only',
      provider: NotificationProvider.INTERNAL_REALTIME,
      channel: NotificationChannel.IN_APP,
      result: 'SENT',
    })
  })

  it('schedules a retryable failure with backoff', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, smsSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_sms_retry',
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          destination: '+15551234567',
          templateKey: 'booking_confirmed',
          attemptCount: 1,
          maxAttempts: 5,
        }),
      ],
    })

    smsSend.mockResolvedValue({
      ok: false,
      retryable: true,
      code: 'SMS_PROVIDER_ERROR',
      message: 'twilio timeout',
      providerStatus: 'error',
      responseMeta: {
        source: 'sendSms',
      },
    })

    const result = await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    const expectedNextAttemptAt = new Date(now.getTime() + 5 * 60_000)

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'RETRYABLE_FAILURE',
      deliveryId: 'delivery_sms_retry',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      nextAttemptAt: expectedNextAttemptAt,
      code: 'SMS_PROVIDER_ERROR',
      message: 'twilio timeout',
      providerStatus: 'error',
      responseMeta: {
        source: 'sendSms',
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 1,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_sms_retry',
          provider: NotificationProvider.TWILIO,
          channel: NotificationChannel.SMS,
          result: 'RETRY_SCHEDULED',
          nextAttemptAt: expectedNextAttemptAt,
        },
      ],
    })
  })

  it('marks final failure when retryable send has no attempts remaining', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, emailSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_email_final',
          channel: NotificationChannel.EMAIL,
          provider: NotificationProvider.POSTMARK,
          destination: 'client@example.com',
          templateKey: 'booking_confirmed',
          attemptCount: 5,
          maxAttempts: 6,
        }),
      ],
    })

    emailSend.mockResolvedValue({
      ok: false,
      retryable: true,
      code: 'POSTMARK_HTTP_429',
      message: 'Rate limited',
      providerStatus: 'http_429',
      responseMeta: {
        source: 'sendEmail',
      },
    })

    const result = await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'FINAL_FAILURE',
      deliveryId: 'delivery_email_final',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      code: 'POSTMARK_HTTP_429',
      message: 'Rate limited',
      providerStatus: 'http_429',
      responseMeta: {
        source: 'sendEmail',
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 1,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_email_final',
          provider: NotificationProvider.POSTMARK,
          channel: NotificationChannel.EMAIL,
          result: 'FAILED_FINAL',
        },
      ],
    })
  })

  it('marks final failure on non-retryable send result', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, emailSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_email_invalid',
          channel: NotificationChannel.EMAIL,
          provider: NotificationProvider.POSTMARK,
          destination: 'client@example.com',
          templateKey: 'booking_confirmed',
          attemptCount: 0,
          maxAttempts: 6,
        }),
      ],
    })

    emailSend.mockResolvedValue({
      ok: false,
      retryable: false,
      code: 'EMAIL_REQUEST_INVALID',
      message: 'sendEmail: missing content.subject',
      providerStatus: 'invalid_request',
      responseMeta: {
        source: 'sendEmail',
      },
    })

    const result = await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'FINAL_FAILURE',
      deliveryId: 'delivery_email_invalid',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      code: 'EMAIL_REQUEST_INVALID',
      message: 'sendEmail: missing content.subject',
      providerStatus: 'invalid_request',
      responseMeta: {
        source: 'sendEmail',
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 1,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_email_invalid',
          provider: NotificationProvider.POSTMARK,
          channel: NotificationChannel.EMAIL,
          result: 'FAILED_FINAL',
        },
      ],
    })
  })

  it('reschedules a retry (not a permanent drop) when an orchestration error has attempts remaining', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_throw_1',
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          destination: 'client_1',
          templateKey: 'booking_confirmed',
          attemptCount: 0,
          maxAttempts: 3,
        }),
      ],
    })

    inAppSend.mockRejectedValue(new Error('redis offline'))

    const result = await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    const expectedNextAttemptAt = new Date(now.getTime() + 60_000)

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'RETRYABLE_FAILURE',
      deliveryId: 'delivery_throw_1',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      nextAttemptAt: expectedNextAttemptAt,
      code: 'DELIVERY_ORCHESTRATION_ERROR',
      message: 'redis offline',
      providerStatus: 'orchestration_error',
      responseMeta: {
        source: 'processDueDeliveries',
        provider: NotificationProvider.INTERNAL_REALTIME,
        channel: NotificationChannel.IN_APP,
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 1,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_throw_1',
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          result: 'RETRY_SCHEDULED',
          nextAttemptAt: expectedNextAttemptAt,
        },
      ],
    })
  })

  it('finalizes an orchestration error as a permanent failure only once attempts are exhausted', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_throw_exhausted',
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          destination: 'client_1',
          templateKey: 'booking_confirmed',
          attemptCount: 2,
          maxAttempts: 3,
        }),
      ],
    })

    inAppSend.mockRejectedValue(new Error('redis offline'))

    const result = await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'FINAL_FAILURE',
      deliveryId: 'delivery_throw_exhausted',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      code: 'DELIVERY_ORCHESTRATION_ERROR',
      message: 'redis offline',
      providerStatus: 'orchestration_error',
      responseMeta: {
        source: 'processDueDeliveries',
        provider: NotificationProvider.INTERNAL_REALTIME,
        channel: NotificationChannel.IN_APP,
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 1,
      outcomes: [
        {
          deliveryId: 'delivery_throw_exhausted',
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          result: 'ORCHESTRATION_ERROR',
          message: 'redis offline',
        },
      ],
    })
  })

  it('returns orchestration error when claimed delivery is missing leaseToken', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend, smsSend, emailSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_missing_lease',
          leaseToken: null,
          channel: NotificationChannel.SMS,
          provider: NotificationProvider.TWILIO,
          destination: '+15551234567',
          templateKey: 'booking_confirmed',
        }),
      ],
    })

    const result = await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    expect(inAppSend).not.toHaveBeenCalled()
    expect(smsSend).not.toHaveBeenCalled()
    expect(emailSend).not.toHaveBeenCalled()
    expect(mockCompleteDeliveryAttempt).not.toHaveBeenCalled()

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 1,
      outcomes: [
        {
          deliveryId: 'delivery_missing_lease',
          provider: NotificationProvider.TWILIO,
          channel: NotificationChannel.SMS,
          result: 'ORCHESTRATION_ERROR',
          message:
            'Claimed delivery is missing leaseToken. Delivery could not be finalized because lease ownership is required.',
        },
      ],
    })
  })

  it('reschedules a templateKey-mismatch orchestration error while attempts remain', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_bad_template',
          templateKey: 'totally_invalid_template_key',
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          destination: 'client_1',
          eventKey: NotificationEventKey.BOOKING_CONFIRMED,
          attemptCount: 0,
          maxAttempts: 3,
        }),
      ],
    })

    const result = await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    expect(inAppSend).not.toHaveBeenCalled()

    const expectedNextAttemptAt = new Date(now.getTime() + 60_000)

    expect(mockCompleteDeliveryAttempt).toHaveBeenCalledWith({
      kind: 'RETRYABLE_FAILURE',
      deliveryId: 'delivery_bad_template',
      leaseToken: 'lease_token_1',
      attemptedAt: now,
      nextAttemptAt: expectedNextAttemptAt,
      code: 'DELIVERY_ORCHESTRATION_ERROR',
      message:
        'processDueDeliveries: delivery templateKey totally_invalid_template_key does not match event BOOKING_CONFIRMED (booking_confirmed)',
      providerStatus: 'orchestration_error',
      responseMeta: {
        source: 'processDueDeliveries',
        provider: NotificationProvider.INTERNAL_REALTIME,
        channel: NotificationChannel.IN_APP,
      },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 1,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [
        {
          deliveryId: 'delivery_bad_template',
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          result: 'RETRY_SCHEDULED',
          nextAttemptAt: expectedNextAttemptAt,
        },
      ],
    })
  })

  it('keeps the delivery claimable (lease-expiry recovery) when even recording the retry fails', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers, inAppSend } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [
        makeClaimedDelivery({
          id: 'delivery_finalize_fail',
          channel: NotificationChannel.IN_APP,
          provider: NotificationProvider.INTERNAL_REALTIME,
          destination: 'client_1',
          templateKey: 'booking_confirmed',
          attemptCount: 0,
          maxAttempts: 3,
        }),
      ],
    })

    inAppSend.mockRejectedValue(new Error('redis offline'))
    mockCompleteDeliveryAttempt.mockRejectedValueOnce(
      new Error('db finalize failed'),
    )

    const result = await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now },
    })

    expect(result).toEqual({
      claimedCount: 1,
      processedCount: 1,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 1,
      outcomes: [
        {
          deliveryId: 'delivery_finalize_fail',
          provider: NotificationProvider.INTERNAL_REALTIME,
          channel: NotificationChannel.IN_APP,
          result: 'ORCHESTRATION_ERROR',
          message:
            'redis offline Retry scheduling also failed: db finalize failed',
        },
      ],
    })
  })

  it('returns empty counts when no deliveries are claimed', async () => {
    const now = new Date('2026-04-09T12:00:00.000Z')
    const { providers } = makeProviders()

    mockClaimDeliveries.mockResolvedValue({
      now,
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      deliveries: [],
    })

    const result = await processDueDeliveries({
      providers,
      tenantContext: rootTenantContext('tenant_root'),
      claim: { now, batchSize: 20 },
    })

    expect(mockClaimDeliveries).toHaveBeenCalledWith({
      now,
      batchSize: 20,
    })

    expect(result).toEqual({
      claimedCount: 0,
      processedCount: 0,
      sentCount: 0,
      retryScheduledCount: 0,
      finalFailureCount: 0,
      orchestrationErrorCount: 0,
      outcomes: [],
    })
  })

  it('throws for invalid now', async () => {
    const { providers } = makeProviders()

    await expect(
      processDueDeliveries({
        providers,
        tenantContext: rootTenantContext('tenant_root'),
        claim: {
          now: new Date('invalid'),
        },
      }),
    ).rejects.toThrow('processDueDeliveries: invalid now')
  })
})

describe('lib/notifications/delivery/processDueDeliveries — resolveSmsLinkOverrides', () => {
  beforeEach(() => {
    mockGetOrCreateShortLink.mockReset()
    mockBuildShortLinkUrl.mockReset()
    mockCaptureNotificationException.mockReset()
  })

  it('returns nulls for a non-SMS channel without minting anything', async () => {
    const delivery = makeClaimedDelivery({ channel: NotificationChannel.IN_APP })

    const result = await resolveSmsLinkOverrides({
      delivery,
      calendarLinks: null,
    })

    expect(result).toEqual({ smsHref: null, smsCalendarUrl: null })
    expect(mockGetOrCreateShortLink).not.toHaveBeenCalled()
  })

  it('mints a short link for the dispatch href on an SMS delivery', async () => {
    const delivery = makeClaimedDelivery({ channel: NotificationChannel.SMS })
    mockGetOrCreateShortLink.mockResolvedValue({ code: 'Ab3xK9pQ' })
    mockBuildShortLinkUrl.mockReturnValue('https://tovis.me/s/Ab3xK9pQ')

    const result = await resolveSmsLinkOverrides({
      delivery,
      calendarLinks: null,
    })

    expect(result).toEqual({
      smsHref: 'https://tovis.me/s/Ab3xK9pQ',
      smsCalendarUrl: null,
    })
    expect(mockGetOrCreateShortLink).toHaveBeenCalledWith({
      destinationPath: delivery.dispatch.href,
      createdForType: 'notification_dispatch_href',
      createdForId: delivery.dispatch.id,
      expiresAt: null,
    })
    expect(mockBuildShortLinkUrl).toHaveBeenCalledWith('Ab3xK9pQ')
  })

  it('mirrors the underlying ClientActionToken expiry from the dispatch payload onto the short link', async () => {
    const delivery = makeClaimedDelivery({ channel: NotificationChannel.SMS })
    delivery.dispatch.payload = {
      bookingId: 'booking_1',
      expiresAt: '2026-08-20T00:00:00.000Z',
    } satisfies Prisma.JsonValue
    mockGetOrCreateShortLink.mockResolvedValue({ code: 'Ab3xK9pQ' })
    mockBuildShortLinkUrl.mockReturnValue('https://tovis.me/s/Ab3xK9pQ')

    await resolveSmsLinkOverrides({ delivery, calendarLinks: null })

    expect(mockGetOrCreateShortLink).toHaveBeenCalledWith({
      destinationPath: delivery.dispatch.href,
      createdForType: 'notification_dispatch_href',
      createdForId: delivery.dispatch.id,
      expiresAt: new Date('2026-08-20T00:00:00.000Z'),
    })
  })

  it('ignores an unparsable expiresAt in the payload rather than throwing', async () => {
    const delivery = makeClaimedDelivery({ channel: NotificationChannel.SMS })
    delivery.dispatch.payload = {
      bookingId: 'booking_1',
      expiresAt: 'not-a-date',
    } satisfies Prisma.JsonValue
    mockGetOrCreateShortLink.mockResolvedValue({ code: 'Ab3xK9pQ' })
    mockBuildShortLinkUrl.mockReturnValue('https://tovis.me/s/Ab3xK9pQ')

    await resolveSmsLinkOverrides({ delivery, calendarLinks: null })

    expect(mockGetOrCreateShortLink).toHaveBeenCalledWith({
      destinationPath: delivery.dispatch.href,
      createdForType: 'notification_dispatch_href',
      createdForId: delivery.dispatch.id,
      expiresAt: null,
    })
  })

  it('also mints a short link for the calendar ics url when present', async () => {
    const delivery = makeClaimedDelivery({ channel: NotificationChannel.SMS })
    mockGetOrCreateShortLink
      .mockResolvedValueOnce({ code: 'HrefCode1' })
      .mockResolvedValueOnce({ code: 'CalCode22' })
    mockBuildShortLinkUrl
      .mockReturnValueOnce('https://tovis.me/s/HrefCode1')
      .mockReturnValueOnce('https://tovis.me/s/CalCode22')

    const result = await resolveSmsLinkOverrides({
      delivery,
      calendarLinks: {
        googleUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE',
        icsUrl: 'https://tovis.test/api/v1/calendar/ics/v1.abc.def',
      },
    })

    expect(result).toEqual({
      smsHref: 'https://tovis.me/s/HrefCode1',
      smsCalendarUrl: 'https://tovis.me/s/CalCode22',
    })
    expect(mockGetOrCreateShortLink).toHaveBeenNthCalledWith(2, {
      destinationPath: '/api/v1/calendar/ics/v1.abc.def',
      createdForType: 'notification_dispatch_calendar',
      createdForId: delivery.dispatch.id,
    })
  })

  it('falls back to null (never throws) when the href mint fails', async () => {
    const delivery = makeClaimedDelivery({ channel: NotificationChannel.SMS })
    mockGetOrCreateShortLink.mockRejectedValue(new Error('destination not allowlisted'))

    const result = await resolveSmsLinkOverrides({
      delivery,
      calendarLinks: null,
    })

    expect(result).toEqual({ smsHref: null, smsCalendarUrl: null })
  })

  it('falls back to null for the calendar link alone when only that mint fails', async () => {
    const delivery = makeClaimedDelivery({ channel: NotificationChannel.SMS })
    mockGetOrCreateShortLink
      .mockResolvedValueOnce({ code: 'HrefCode1' })
      .mockRejectedValueOnce(new Error('db hiccup'))
    mockBuildShortLinkUrl.mockReturnValueOnce('https://tovis.me/s/HrefCode1')

    const result = await resolveSmsLinkOverrides({
      delivery,
      calendarLinks: {
        googleUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE',
        icsUrl: 'https://tovis.test/api/v1/calendar/ics/v1.abc.def',
      },
    })

    expect(result).toEqual({
      smsHref: 'https://tovis.me/s/HrefCode1',
      smsCalendarUrl: null,
    })
  })

  // ⚠️ The production regression, at the pipeline level. A pro booking-finalize
  // notification carries `/pro/bookings/{id}`; before that prefix was
  // allowlisted the mint threw and the SMS shipped the long URL instead. The
  // allowlist itself is pinned in lib/shortLink/allowlist.test.ts — this pins
  // that the drain actually asks for the pro path and uses what comes back.
  it('mints a short link for a pro booking-finalize notification href', async () => {
    const delivery = makeClaimedDelivery({
      channel: NotificationChannel.SMS,
      eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
    })
    delivery.dispatch.href = '/pro/bookings/cmtb32x6n0007l804guk94sgl'
    mockGetOrCreateShortLink.mockResolvedValue({ code: 'ProBk9pQ1' })
    mockBuildShortLinkUrl.mockReturnValue('https://tovis.me/s/ProBk9pQ1')

    const result = await resolveSmsLinkOverrides({
      delivery,
      calendarLinks: null,
    })

    expect(result.smsHref).toBe('https://tovis.me/s/ProBk9pQ1')
    expect(mockGetOrCreateShortLink).toHaveBeenCalledWith({
      destinationPath: '/pro/bookings/cmtb32x6n0007l804guk94sgl',
      createdForType: 'notification_dispatch_href',
      createdForId: delivery.dispatch.id,
      expiresAt: null,
    })
    expect(mockCaptureNotificationException).not.toHaveBeenCalled()
  })

  it('retries a transient href mint failure once and uses the second result', async () => {
    const delivery = makeClaimedDelivery({ channel: NotificationChannel.SMS })
    mockGetOrCreateShortLink
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({ code: 'Retried1' })
    mockBuildShortLinkUrl.mockReturnValue('https://tovis.me/s/Retried1')

    const result = await resolveSmsLinkOverrides({
      delivery,
      calendarLinks: null,
    })

    expect(result.smsHref).toBe('https://tovis.me/s/Retried1')
    expect(mockGetOrCreateShortLink).toHaveBeenCalledTimes(2)
    expect(mockCaptureNotificationException).not.toHaveBeenCalled()
  })

  it('captures — and stops retrying — when a transient mint fails twice', async () => {
    const delivery = makeClaimedDelivery({ channel: NotificationChannel.SMS })
    mockGetOrCreateShortLink.mockRejectedValue(new Error('connection reset'))

    const result = await resolveSmsLinkOverrides({
      delivery,
      calendarLinks: null,
    })

    expect(result).toEqual({ smsHref: null, smsCalendarUrl: null })
    expect(mockGetOrCreateShortLink).toHaveBeenCalledTimes(2)
    expect(mockCaptureNotificationException).toHaveBeenCalledTimes(1)
    expect(mockCaptureNotificationException).toHaveBeenCalledWith(
      expect.objectContaining({
        route: 'processDueDeliveries',
        event: 'SHORT_LINK_MINT_FAILED',
        dispatchId: delivery.dispatch.id,
        deliveryId: delivery.id,
      }),
    )
  })

  // A rejected destination is deterministic — a second call returns the
  // identical refusal — so it must NOT burn a retry, but it MUST alert: it means
  // an allowlist gap that degrades every send of that event until someone edits
  // lib/shortLink/allowlist.ts.
  it('does not retry a non-allowlisted destination, but still captures it', async () => {
    const delivery = makeClaimedDelivery({ channel: NotificationChannel.SMS })
    delivery.dispatch.href = '/pro/dashboard'
    mockGetOrCreateShortLink.mockRejectedValue(
      new ShortLinkDestinationNotAllowedError('/pro/dashboard'),
    )

    const result = await resolveSmsLinkOverrides({
      delivery,
      calendarLinks: null,
    })

    expect(result).toEqual({ smsHref: null, smsCalendarUrl: null })
    expect(mockGetOrCreateShortLink).toHaveBeenCalledTimes(1)
    expect(mockCaptureNotificationException).toHaveBeenCalledTimes(1)
    expect(mockCaptureNotificationException).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'SHORT_LINK_MINT_FAILED',
        dispatchId: delivery.dispatch.id,
      }),
    )
  })

  it('skips the calendar mint entirely when there is no ics url', async () => {
    const delivery = makeClaimedDelivery({ channel: NotificationChannel.SMS })
    mockGetOrCreateShortLink.mockResolvedValue({ code: 'HrefCode1' })
    mockBuildShortLinkUrl.mockReturnValue('https://tovis.me/s/HrefCode1')

    const result = await resolveSmsLinkOverrides({
      delivery,
      calendarLinks: {
        googleUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE',
        icsUrl: null,
      },
    })

    expect(result).toEqual({
      smsHref: 'https://tovis.me/s/HrefCode1',
      smsCalendarUrl: null,
    })
    expect(mockGetOrCreateShortLink).toHaveBeenCalledTimes(1)
  })
})

describe('lib/notifications/delivery/processDueDeliveries — resolveIsFirstSmsToDestination', () => {
  beforeEach(() => {
    mockPrisma.notificationDelivery.findFirst.mockReset()
  })

  it('returns false without querying for a non-SMS channel', async () => {
    const delivery = makeClaimedDelivery({ channel: NotificationChannel.IN_APP })

    expect(await resolveIsFirstSmsToDestination(delivery)).toBe(false)
    expect(mockPrisma.notificationDelivery.findFirst).not.toHaveBeenCalled()
  })

  it('returns false without querying when the delivery has no destination', async () => {
    const delivery = makeClaimedDelivery({
      channel: NotificationChannel.SMS,
      destination: '',
    })

    expect(await resolveIsFirstSmsToDestination(delivery)).toBe(false)
    expect(mockPrisma.notificationDelivery.findFirst).not.toHaveBeenCalled()
  })

  it('returns true when no prior SENT/DELIVERED SMS exists for the destination', async () => {
    const delivery = makeClaimedDelivery({
      channel: NotificationChannel.SMS,
      destination: '+15551234567',
    })
    mockPrisma.notificationDelivery.findFirst.mockResolvedValueOnce(null)

    expect(await resolveIsFirstSmsToDestination(delivery)).toBe(true)
    expect(mockPrisma.notificationDelivery.findFirst).toHaveBeenCalledWith({
      where: {
        channel: NotificationChannel.SMS,
        destination: '+15551234567',
        status: { in: [NotificationDeliveryStatus.SENT, NotificationDeliveryStatus.DELIVERED] },
      },
      select: { id: true },
    })
  })

  it('returns false when a prior SENT/DELIVERED SMS already exists for the destination', async () => {
    const delivery = makeClaimedDelivery({
      channel: NotificationChannel.SMS,
      destination: '+15551234567',
    })
    mockPrisma.notificationDelivery.findFirst.mockResolvedValueOnce({
      id: 'prior_delivery_1',
    })

    expect(await resolveIsFirstSmsToDestination(delivery)).toBe(false)
  })
})