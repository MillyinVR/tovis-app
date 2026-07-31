// lib/notifications/delivery/renderNotificationContent.consentSignatureRequest.test.ts
//
// K15: PROVE what the consent-signature EMAIL and SMS actually say.
//
// The mint and the dispatch are covered by the integration suite; this renders
// the template through the real renderNotificationContent path, fed by the
// exact exported builders lib/consentForms/signatureRequest.ts uses, and pins:
//
//   - the form is NAMED (a client who cannot tell what they are being asked to
//     sign is a client who does not tap the link),
//   - the CTA href is the PUBLIC token URL (/client/consent/<token>) — the
//     client this is aimed at is often unclaimed and has no login at all,
//   - and that the SMS length cap can never truncate the signing link: a real
//     salon name plus a long waiver title used to be exactly the shape that
//     pushed a URL off the end of a message ([[green-tests-wrong-artifact]] —
//     the K10-B-1 render test caught that once already on the pay link).
//
// Real provider delivery stays prod-only by design; locally both deliveries
// FAIL_FINAL with no Twilio/Postmark creds, so this render IS the reachable
// proof of the copy.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NotificationChannel, NotificationEventKey } from '@prisma/client'

import { buildClientActionLinkForType } from '@/lib/clientActions/linkBuilders'
import {
  buildConsentSignatureBody,
  buildConsentSignatureTitle,
} from '@/lib/consentForms/signatureRequest'
import { rootTenantContext } from '@/lib/tenant/context'

import {
  renderNotificationContent,
  type NotificationRenderDispatchLike,
} from './renderNotificationContent'

const RAW_TOKEN = 'cd'.repeat(32)
const FORM_TITLE = 'Corrective colour waiver'

function buildDispatch(overrides?: {
  title?: string
  body?: string
}): NotificationRenderDispatchLike {
  const link = buildClientActionLinkForType({
    actionType: 'CONSENT_SIGNATURE',
    rawToken: RAW_TOKEN,
  })

  return {
    eventKey: NotificationEventKey.CONSENT_SIGNATURE_REQUEST,
    title: overrides?.title ?? buildConsentSignatureTitle(FORM_TITLE),
    body:
      overrides?.body ??
      buildConsentSignatureBody({
        professionalName: 'Ava Styles',
        formTitle: FORM_TITLE,
      }),
    href: link.href,
    payload: { bookingId: 'booking_1' },
  }
}

describe('consent_signature_request render (K15)', () => {
  const originalAppUrl = process.env.APP_URL
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL

  beforeEach(() => {
    process.env.APP_URL = 'https://tovis.test'
    process.env.NEXT_PUBLIC_APP_URL = 'https://tovis.test'
  })

  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL
    else process.env.APP_URL = originalAppUrl

    if (originalNextPublicAppUrl === undefined)
      delete process.env.NEXT_PUBLIC_APP_URL
    else process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl
  })

  it('names the form even when the pro has no display name', () => {
    expect(buildConsentSignatureTitle(FORM_TITLE)).toBe(
      'Please sign: Corrective colour waiver',
    )
    // A form with no title still produces a sentence, never "Please sign: ".
    expect(buildConsentSignatureTitle('   ')).toBe(
      'Please sign your consent form',
    )
    expect(
      buildConsentSignatureBody({ professionalName: null, formTitle: '' }),
    ).toContain('a consent form')
  })

  it('EMAIL names the form and links to the PUBLIC token page', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.EMAIL,
      templateKey: 'consent_signature_request',
      templateVersion: 1,
      dispatch: buildDispatch(),
    })

    if (result.channel !== NotificationChannel.EMAIL) {
      throw new Error('expected EMAIL content')
    }

    expect(result.subject).toBe('TOVIS: Please sign: Corrective colour waiver')

    for (const text of [result.text, result.html]) {
      expect(text).toContain(FORM_TITLE)
      expect(text).toContain('Ava Styles')
    }

    const publicUrl = `https://tovis.test/client/consent/${RAW_TOKEN}`
    expect(result.text).toContain(`Read and sign: ${publicUrl}`)
    expect(result.html).toContain(`<a href="${publicUrl}">Read and sign</a>`)
    // Never a login-gated surface: this recipient usually has no account.
    expect(result.text).not.toContain('/client/bookings/')
    expect(result.html).not.toContain('/client/bookings/')
  })

  it('SMS carries the same facts and the full, unbroken token URL', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.SMS,
      templateKey: 'consent_signature_request',
      templateVersion: 1,
      dispatch: buildDispatch(),
    })

    if (result.channel !== NotificationChannel.SMS) {
      throw new Error('expected SMS content')
    }

    expect(result.text).toContain('Please sign: Corrective colour waiver')
    expect(result.text).toContain(
      `https://tovis.test/client/consent/${RAW_TOKEN}`,
    )
  })

  it('🔴 the SMS length cap clips the prose, NEVER the signing link', () => {
    // A real salon name and a real waiver title together are exactly the shape
    // that pushes a URL off the end — and a broken link is the whole message
    // wasted for a phone-only unclaimed client.
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.SMS,
      templateKey: 'consent_signature_request',
      templateVersion: 1,
      dispatch: buildDispatch({
        title: buildConsentSignatureTitle(
          'Corrective colour, bleach and chemical service release waiver (2026 revision)',
        ),
        body: buildConsentSignatureBody({
          professionalName:
            'Alexandra Beaumont-Castellanos Hair & Beauty Studio',
          formTitle:
            'Corrective colour, bleach and chemical service release waiver (2026 revision)',
        }),
      }),
    })

    if (result.channel !== NotificationChannel.SMS) {
      throw new Error('expected SMS content')
    }

    expect(result.text.length).toBeLessThanOrEqual(320)
    expect(result.text).toMatch(
      new RegExp(`https://tovis\\.test/client/consent/${RAW_TOKEN}$`),
    )
  })
})
