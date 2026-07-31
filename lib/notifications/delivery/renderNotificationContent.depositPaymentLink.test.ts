// lib/notifications/delivery/renderNotificationContent.depositPaymentLink.test.ts
//
// K10-B-1 sub-ask 1: PROVE what the deposit pay-link EMAIL and SMS actually
// say. The enqueue was already tested; this renders the template through the
// real renderNotificationContent path, feeding it the dispatch values built by
// the exact exported builders the write boundary uses
// (lib/clientActions/createDepositPaymentDelivery.ts), and pins:
//
//   - the amount label,
//   - the pay-by deadline formatted in the LOCATION's timezone,
//   - the auto-release consequence,
//   - the CTA href = the PUBLIC token URL (/client/deposit/<token>), never a
//     login-gated path,
//   - and that the SMS length cap can never truncate the pay link (the human
//     text is clipped around it instead).
//
// Real provider delivery stays prod-only by design; this render is the
// reachable proof, and a post-deploy smoke send remains Tori's.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NotificationChannel, NotificationEventKey } from '@prisma/client'

import {
  buildDepositPaymentBody,
  buildDepositPaymentNudgeBody,
  buildDepositPaymentNudgeTitle,
  buildDepositPaymentTitle,
  formatDepositPayByLabel,
} from '@/lib/clientActions/createDepositPaymentDelivery'
import { buildClientActionLinkForType } from '@/lib/clientActions/linkBuilders'
import { rootTenantContext } from '@/lib/tenant/context'

import {
  renderNotificationContent,
  type NotificationRenderDispatchLike,
} from './renderNotificationContent'

// A realistic raw token: generateClientActionToken() returns 32 random bytes
// as 64 hex chars.
const RAW_TOKEN = 'ab'.repeat(32)

// 2026-08-15T02:30Z is Fri Aug 14, 7:30 PM in America/Los_Angeles (PDT) —
// crossing the day boundary, so a server-zone (UTC) render would say "Sat,
// Aug 15" and fail the pin.
const DUE_AT = new Date('2026-08-15T02:30:00.000Z')
const ZONE = 'America/Los_Angeles'
const PAY_BY_LABEL = 'Fri, Aug 14, 2026, 7:30 PM'

function buildPayLinkDispatch(overrides?: {
  title?: string
  body?: string
}): NotificationRenderDispatchLike {
  const link = buildClientActionLinkForType({
    actionType: 'DEPOSIT_PAYMENT',
    rawToken: RAW_TOKEN,
  })

  return {
    eventKey: NotificationEventKey.DEPOSIT_PAYMENT_LINK,
    title:
      overrides?.title ?? buildDepositPaymentTitle('$40.00'),
    body:
      overrides?.body ??
      buildDepositPaymentBody({
        professionalName: 'Ava Styles',
        payByLabel: formatDepositPayByLabel(DUE_AT, ZONE),
      }),
    href: link.href,
    payload: { bookingId: 'booking_1' },
  }
}

describe('deposit_payment_link render (K10-B-1)', () => {
  const originalAppUrl = process.env.APP_URL
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL

  beforeEach(() => {
    process.env.APP_URL = 'https://tovis.test'
    process.env.NEXT_PUBLIC_APP_URL = 'https://tovis.test'
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

  it('formats the pay-by deadline in the LOCATION timezone (never the server zone)', () => {
    expect(formatDepositPayByLabel(DUE_AT, ZONE)).toBe(PAY_BY_LABEL)
    // A missing/invalid zone degrades to UTC — never to a throw or a lie
    // about the location's local time.
    expect(formatDepositPayByLabel(DUE_AT, null)).toBe(
      'Sat, Aug 15, 2026, 2:30 AM',
    )
    expect(formatDepositPayByLabel(DUE_AT, 'Not/AZone')).toBe(
      'Sat, Aug 15, 2026, 2:30 AM',
    )
  })

  it('EMAIL carries the amount, the zoned deadline, the auto-release consequence, and the PUBLIC token CTA', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.EMAIL,
      templateKey: 'deposit_payment_link',
      templateVersion: 1,
      dispatch: buildPayLinkDispatch(),
    })

    if (result.channel !== NotificationChannel.EMAIL) {
      throw new Error('expected EMAIL content')
    }

    expect(result.subject).toBe('TOVIS: Pay your $40.00 deposit')

    for (const text of [result.text, result.html]) {
      expect(text).toContain('$40.00')
      expect(text).toContain(PAY_BY_LABEL)
      expect(text).toContain('released automatically if it stays unpaid')
    }

    // The CTA is the PUBLIC token URL — an unclaimed client has no login.
    const publicUrl = `https://tovis.test/client/deposit/${RAW_TOKEN}`
    expect(result.text).toContain(`Pay your deposit: ${publicUrl}`)
    expect(result.html).toContain(
      `<a href="${publicUrl}">Pay your deposit</a>`,
    )
    // Never the login-gated booking surface.
    expect(result.text).not.toContain('/client/bookings/')
    expect(result.html).not.toContain('/client/bookings/')
  })

  it('SMS carries the same facts and the full, unbroken token URL', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.SMS,
      templateKey: 'deposit_payment_link',
      templateVersion: 1,
      dispatch: buildPayLinkDispatch(),
    })

    if (result.channel !== NotificationChannel.SMS) {
      throw new Error('expected SMS content')
    }

    expect(result.text).toContain('TOVIS: Pay your $40.00 deposit')
    expect(result.text).toContain(PAY_BY_LABEL)
    expect(result.text).toContain('released automatically if it stays unpaid')
    expect(result.text).toContain(
      `https://tovis.test/client/deposit/${RAW_TOKEN}`,
    )
    expect(result.text).not.toContain('/client/bookings/')
  })

  it('the SMS length cap clips the human text, NEVER the pay link', () => {
    // A long (but real-world) professional name used to push the joined text
    // past MAX_SMS_TEXT and truncate the trailing URL — a broken link on the
    // one message a phone-only unclaimed client gets.
    const longName = 'Alexandra Beaumont-Castellanos Hair & Beauty Studio'
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.SMS,
      templateKey: 'deposit_payment_link',
      templateVersion: 1,
      dispatch: buildPayLinkDispatch({
        body: buildDepositPaymentBody({
          professionalName: longName,
          payByLabel: formatDepositPayByLabel(DUE_AT, ZONE),
        }),
      }),
    })

    if (result.channel !== NotificationChannel.SMS) {
      throw new Error('expected SMS content')
    }

    expect(result.text.length).toBeLessThanOrEqual(320)
    // The URL survives intact at the tail; the prose lost characters instead.
    expect(result.text).toMatch(
      new RegExp(`https://tovis\\.test/client/deposit/${RAW_TOKEN}$`),
    )
  })

  it('the pre-release NUDGE copy renders through the same template with the same public link', () => {
    const link = buildClientActionLinkForType({
      actionType: 'DEPOSIT_PAYMENT',
      rawToken: RAW_TOKEN,
    })
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.SMS,
      templateKey: 'deposit_payment_link',
      templateVersion: 1,
      dispatch: {
        eventKey: NotificationEventKey.DEPOSIT_PAYMENT_LINK,
        title: buildDepositPaymentNudgeTitle('$40.00'),
        body: buildDepositPaymentNudgeBody({
          professionalName: 'Ava Styles',
          payByLabel: formatDepositPayByLabel(DUE_AT, ZONE),
        }),
        href: link.href,
        payload: { bookingId: 'booking_1', nudge: true },
      },
    })

    if (result.channel !== NotificationChannel.SMS) {
      throw new Error('expected SMS content')
    }

    expect(result.text).toContain('Reminder: pay your $40.00 deposit')
    expect(result.text).toContain('still waiting on its deposit')
    expect(result.text).toContain(`Pay by ${PAY_BY_LABEL}`)
    expect(result.text).toContain('released automatically if it stays unpaid')
    expect(result.text).toContain(
      `https://tovis.test/client/deposit/${RAW_TOKEN}`,
    )
  })
})
