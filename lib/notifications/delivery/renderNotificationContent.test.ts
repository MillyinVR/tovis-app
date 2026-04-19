import { describe, expect, it } from 'vitest'
import { NotificationChannel, NotificationEventKey } from '@prisma/client'

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
  }
}

describe('lib/notifications/delivery/renderNotificationContent', () => {
  it('renders in-app content from dispatch values', () => {
    const result = renderNotificationContent({
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

  it('renders branded SMS content with internal href appended', () => {
    const result = renderNotificationContent({
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
      'TOVIS: Appointment confirmed Your appointment has been confirmed. /client/bookings/booking_1',
    )
  })

  it('renders branded email content with CTA text and html', () => {
    const result = renderNotificationContent({
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
      'View aftercare: /client/bookings/booking_1?step=aftercare',
    )
    expect(result.html).toContain('<h1>Aftercare ready</h1>')
    expect(result.html).toContain('<p>Your aftercare plan is ready.</p>')
    expect(result.html).toContain(
      '<a href="/client/bookings/booking_1?step=aftercare">View aftercare</a>',
    )
  })

  it('renders viral request approved email content with the viral CTA label', () => {
    const result = renderNotificationContent({
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
    expect(result.text).toContain('"Wolf Cut" was approved and matches your services.')
    expect(result.text).toContain(
      'View request: /admin/viral-requests/request_1',
    )
    expect(result.html).toContain(
      '<h1>New viral request in your category</h1>',
    )
    expect(result.html).toContain(
      '<p>&quot;Wolf Cut&quot; was approved and matches your services.</p>',
    )
    expect(result.html).toContain(
      '<a href="/admin/viral-requests/request_1">View request</a>',
    )
  })

  it('drops unsafe external href values from rendered content', () => {
    const inAppResult = renderNotificationContent({
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