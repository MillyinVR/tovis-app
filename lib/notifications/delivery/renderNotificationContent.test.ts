import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NotificationChannel, NotificationEventKey } from '@prisma/client'

import { rootTenantContext } from '@/lib/tenant/context'

import { NOTIFICATION_EVENT_DEFINITIONS } from '../eventKeys'
import {
  renderNotificationContent,
  type NotificationRenderDispatchLike,
} from './renderNotificationContent'

function makeDispatch(
  overrides: Partial<NotificationRenderDispatchLike> = {},
): NotificationRenderDispatchLike {
  return {
    eventKey: overrides.eventKey ?? NotificationEventKey.BOOKING_CONFIRMED,
    title: overrides.title ?? ' Appointment confirmed ',
    body: overrides.body ?? ' Your appointment has been confirmed. ',
    href: overrides.href ?? ' /client/bookings/booking_1 ',
    payload: overrides.payload ?? {
      bookingId: 'booking_1',
    },
    ...(overrides.calendarLinks !== undefined
      ? { calendarLinks: overrides.calendarLinks }
      : {}),
  }
}

describe('lib/notifications/delivery/renderNotificationContent', () => {
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

  it('renders in-app content from dispatch values', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.IN_APP,
      templateKey: 'booking_confirmed',
      templateVersion: 1,
      dispatch: makeDispatch(),
    })

    expect(result).toEqual({
      channel: NotificationChannel.IN_APP,
      templateKey: 'booking_confirmed',
      templateVersion: 1,
      title: 'Appointment confirmed',
      body: 'Your appointment has been confirmed.',
      href: '/client/bookings/booking_1',
    })
  })

  it('renders push content (title/body + internal href, no brand prefix)', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.PUSH,
      templateKey: 'booking_confirmed',
      templateVersion: 1,
      dispatch: makeDispatch(),
    })

    expect(result).toEqual({
      channel: NotificationChannel.PUSH,
      templateKey: 'booking_confirmed',
      templateVersion: 1,
      title: 'Appointment confirmed',
      body: 'Your appointment has been confirmed.',
      href: '/client/bookings/booking_1',
    })
  })

  it('omits the push href when the dispatch has no internal link', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.PUSH,
      templateKey: 'booking_confirmed',
      templateVersion: 1,
      dispatch: makeDispatch({ href: '' }),
    })

    expect(result).not.toHaveProperty('href')
  })

  it('renders branded SMS content with absolute app href appended', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.SMS,
      templateKey: 'booking_confirmed',
      dispatch: makeDispatch(),
    })

    expect(result.channel).toBe(NotificationChannel.SMS)

    if (result.channel !== NotificationChannel.SMS) {
      throw new Error('expected SMS content')
    }

    expect(result.templateKey).toBe('booking_confirmed')
    expect(result.text).toBe(
      'TOVIS: Appointment confirmed Your appointment has been confirmed. https://tovis.test/client/bookings/booking_1',
    )
  })

  const calendarLinks = {
    googleUrl:
      'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Balayage',
    icsUrl: 'https://tovis.test/api/v1/calendar/ics/v1.abc.def',
  }

  it('appends both calendar links to a booking email when calendarLinks are present', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.EMAIL,
      templateKey: 'booking_confirmed',
      dispatch: makeDispatch({ calendarLinks }),
    })

    if (result.channel !== NotificationChannel.EMAIL) {
      throw new Error('expected EMAIL content')
    }

    // Plain-text part carries the raw (unescaped) URLs.
    expect(result.text).toContain(
      `Add to Google Calendar: ${calendarLinks.googleUrl}`,
    )
    expect(result.text).toContain(
      `Add to Apple or Outlook calendar: ${calendarLinks.icsUrl}`,
    )
    // HTML part hyperlinks them; the & in the google url is html-escaped.
    expect(result.html).toContain('Add to Google Calendar</a>')
    expect(result.html).toContain(
      `<a href="${calendarLinks.icsUrl}">Add to Apple or Outlook calendar</a>`,
    )
  })

  it('appends the same-origin .ics calendar link to a booking SMS (preferred over google)', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.SMS,
      templateKey: 'booking_confirmed',
      dispatch: makeDispatch({ calendarLinks }),
    })

    if (result.channel !== NotificationChannel.SMS) {
      throw new Error('expected SMS content')
    }

    expect(result.text).toContain(`Add to calendar: ${calendarLinks.icsUrl}`)
    expect(result.text).not.toContain(calendarLinks.googleUrl)
  })

  it('falls back to the google calendar link in SMS when the ics url is unavailable', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.SMS,
      templateKey: 'booking_confirmed',
      dispatch: makeDispatch({
        calendarLinks: { googleUrl: calendarLinks.googleUrl, icsUrl: null },
      }),
    })

    if (result.channel !== NotificationChannel.SMS) {
      throw new Error('expected SMS content')
    }

    expect(result.text).toContain(
      `Add to calendar: ${calendarLinks.googleUrl}`,
    )
  })

  it('adds no calendar links when the dispatch carries none', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.EMAIL,
      templateKey: 'booking_confirmed',
      dispatch: makeDispatch(),
    })

    if (result.channel !== NotificationChannel.EMAIL) {
      throw new Error('expected EMAIL content')
    }

    expect(result.text).not.toContain('Add to Google Calendar')
    expect(result.text).not.toContain('Add to Apple or Outlook calendar')
    expect(result.html).not.toContain('Add to Google Calendar')
  })

  it('renders branded email content with CTA text and html using absolute app href', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.EMAIL,
      templateKey: 'aftercare_ready',
      dispatch: makeDispatch({
        eventKey: NotificationEventKey.AFTERCARE_READY,
        title: ' Aftercare ready ',
        body: ' Your aftercare plan is ready. ',
        href: ' /client/bookings/booking_1?step=aftercare ',
      }),
    })

    expect(result.channel).toBe(NotificationChannel.EMAIL)

    if (result.channel !== NotificationChannel.EMAIL) {
      throw new Error('expected EMAIL content')
    }

    expect(result.templateKey).toBe('aftercare_ready')
    expect(result.subject).toBe('TOVIS: Aftercare ready')
    expect(result.text).toContain('Aftercare ready')
    expect(result.text).toContain('Your aftercare plan is ready.')
    expect(result.text).toContain(
      'View aftercare: https://tovis.test/client/bookings/booking_1?step=aftercare',
    )
    expect(result.html).toContain('<h1>Aftercare ready</h1>')
    expect(result.html).toContain('<p>Your aftercare plan is ready.</p>')
    expect(result.html).toContain(
      '<a href="https://tovis.test/client/bookings/booking_1?step=aftercare">View aftercare</a>',
    )
  })

  it('renders viral request approved email content with the viral CTA label and absolute app href', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.EMAIL,
      templateKey: 'viral_request_approved',
      dispatch: makeDispatch({
        eventKey: NotificationEventKey.VIRAL_REQUEST_APPROVED,
        title: ' New viral request in your category ',
        body: ' "Wolf Cut" was approved and matches your services. ',
        href: ' /admin/viral-requests/request_1 ',
      }),
    })

    expect(result.channel).toBe(NotificationChannel.EMAIL)

    if (result.channel !== NotificationChannel.EMAIL) {
      throw new Error('expected EMAIL content')
    }

    expect(result.templateKey).toBe('viral_request_approved')
    expect(result.subject).toBe('TOVIS: New viral request in your category')
    expect(result.text).toContain('New viral request in your category')
    expect(result.text).toContain(
      '"Wolf Cut" was approved and matches your services.',
    )
    expect(result.text).toContain(
      'View request: https://tovis.test/admin/viral-requests/request_1',
    )
    expect(result.html).toContain(
      '<h1>New viral request in your category</h1>',
    )
    expect(result.html).toContain(
      '<p>&quot;Wolf Cut&quot; was approved and matches your services.</p>',
    )
    expect(result.html).toContain(
      '<a href="https://tovis.test/admin/viral-requests/request_1">View request</a>',
    )
  })

  it('drops unsafe external href values from rendered content', () => {
    const inAppResult = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.IN_APP,
      templateKey: 'payment_action_required',
      dispatch: makeDispatch({
        eventKey: NotificationEventKey.PAYMENT_ACTION_REQUIRED,
        title: 'Payment action required',
        body: 'Please update your payment method.',
        href: 'https://evil.example.com/nope',
      }),
    })

    const smsResult = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.SMS,
      templateKey: 'payment_action_required',
      dispatch: makeDispatch({
        eventKey: NotificationEventKey.PAYMENT_ACTION_REQUIRED,
        title: 'Payment action required',
        body: 'Please update your payment method.',
        href: 'https://evil.example.com/nope',
      }),
    })

    expect(inAppResult.channel).toBe(NotificationChannel.IN_APP)
    expect(smsResult.channel).toBe(NotificationChannel.SMS)

    if (inAppResult.channel !== NotificationChannel.IN_APP) {
      throw new Error('expected IN_APP content')
    }

    if (smsResult.channel !== NotificationChannel.SMS) {
      throw new Error('expected SMS content')
    }

    expect(inAppResult.href).toBe('')
    expect(smsResult.text).toBe(
      'TOVIS: Payment action required Please update your payment method.',
    )
  })

  it('throws for unsupported template versions', () => {
    expect(() =>
      renderNotificationContent({
        tenantContext: rootTenantContext('tenant_root'),
        channel: NotificationChannel.EMAIL,
        templateKey: 'booking_confirmed',
        templateVersion: 2,
        dispatch: makeDispatch(),
      }),
    ).toThrow('renderNotificationContent: unsupported templateVersion 2')
  })

  it('can render every currently defined template key', () => {
    for (const definition of Object.values(NOTIFICATION_EVENT_DEFINITIONS)) {
      const result = renderNotificationContent({
        tenantContext: rootTenantContext('tenant_root'),
        channel: NotificationChannel.IN_APP,
        templateKey: definition.templateKey,
        templateVersion: 1,
        dispatch: makeDispatch({
          eventKey: definition.key,
          title: `Title for ${definition.templateKey}`,
          body: `Body for ${definition.templateKey}`,
          href: '/test/path',
        }),
      })

      expect(result.channel).toBe(NotificationChannel.IN_APP)

      if (result.channel !== NotificationChannel.IN_APP) {
        throw new Error('expected IN_APP content')
      }

      expect(result.templateKey).toBe(definition.templateKey)
      expect(result.title).toBe(`Title for ${definition.templateKey}`)
      expect(result.body).toBe(`Body for ${definition.templateKey}`)
      expect(result.href).toBe('/test/path')
    }
  })
})