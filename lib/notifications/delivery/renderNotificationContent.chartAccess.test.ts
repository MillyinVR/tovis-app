// lib/notifications/delivery/renderNotificationContent.chartAccess.test.ts
//
// Drives the ACTUAL render path for the two chart-access templates, rather than
// trusting that registering a template key was enough. A key wired into
// `eventKeys.ts` but missing from the renderer map throws at DELIVERY time —
// long after every unit test has gone green.
//
// The href matters as much as the copy: `/client/settings#chart-sharing` is the
// only surface that can answer the request, and both sanitizers reject anything
// not starting with a single `/`. A fragment must survive intact.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NotificationChannel, NotificationEventKey } from '@prisma/client'

import { rootTenantContext } from '@/lib/tenant/context'

import { NOTIFICATION_EVENT_DEFINITIONS } from '../eventKeys'
import { renderNotificationContent } from './renderNotificationContent'

const CHART_SHARE_HREF = '/client/settings#chart-sharing'

describe('chart-access notification rendering', () => {
  const originalAppUrl = process.env.APP_URL

  beforeEach(() => {
    process.env.APP_URL = 'https://tovis.test'
    process.env.NEXT_PUBLIC_APP_URL = 'https://tovis.test'
  })

  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL
    else process.env.APP_URL = originalAppUrl
  })

  it('registers both events with the template keys the renderer knows', () => {
    expect(
      NOTIFICATION_EVENT_DEFINITIONS[NotificationEventKey.CHART_ACCESS_REQUESTED]
        .templateKey,
    ).toBe('chart_access_requested')
    expect(
      NOTIFICATION_EVENT_DEFINITIONS[NotificationEventKey.CHART_ACCESS_GRANTED]
        .templateKey,
    ).toBe('chart_access_granted')
  })

  it('renders the client-facing request, keeping the settings fragment', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.IN_APP,
      templateKey: 'chart_access_requested',
      templateVersion: 1,
      dispatch: {
        eventKey: NotificationEventKey.CHART_ACCESS_REQUESTED,
        title: 'Glow Studio asked to see your chart',
        body: 'Your chart is the private record they keep about you.',
        href: CHART_SHARE_HREF,
        payload: { professionalId: 'pro_1' },
      },
    })

    // Asserted whole rather than by property: the return is a per-channel
    // union, and the SMS arm has no `title`/`href` to reach for.
    expect(result).toEqual({
      channel: NotificationChannel.IN_APP,
      templateKey: 'chart_access_requested',
      templateVersion: 1,
      title: 'Glow Studio asked to see your chart',
      body: 'Your chart is the private record they keep about you.',
      // The fragment is the whole point — without it the notification lands on
      // settings and the client has to go find the section that answers it.
      href: CHART_SHARE_HREF,
    })
  })

  it('renders the pro-facing grant, linking the chart it just opened', () => {
    const result = renderNotificationContent({
      tenantContext: rootTenantContext('tenant_root'),
      channel: NotificationChannel.IN_APP,
      templateKey: 'chart_access_granted',
      templateVersion: 1,
      dispatch: {
        eventKey: NotificationEventKey.CHART_ACCESS_GRANTED,
        title: 'Rae Kim shared their chart with you',
        body: 'You can now open their chart.',
        href: '/pro/clients/client_1',
        payload: { clientId: 'client_1' },
      },
    })

    expect(result).toEqual({
      channel: NotificationChannel.IN_APP,
      templateKey: 'chart_access_granted',
      templateVersion: 1,
      title: 'Rae Kim shared their chart with you',
      body: 'You can now open their chart.',
      href: '/pro/clients/client_1',
    })
  })

  // Neither event earns a text message: nothing expires if the client answers
  // next week, and a request to read a medical-adjacent record should wait
  // until morning rather than bypass quiet hours.
  it('is in-app + push only, non-transactional, and never bypasses quiet hours', () => {
    for (const key of [
      NotificationEventKey.CHART_ACCESS_REQUESTED,
      NotificationEventKey.CHART_ACCESS_GRANTED,
    ]) {
      const def = NOTIFICATION_EVENT_DEFINITIONS[key]
      expect(def.transactional).toBe(false)
      expect(def.allowQuietHoursBypass).toBe(false)

      const channels = Object.values(def.defaultChannelsByRecipient).flat()
      expect(channels).toContain(NotificationChannel.IN_APP)
      expect(channels).toContain(NotificationChannel.PUSH)
      expect(channels).not.toContain(NotificationChannel.SMS)
      expect(channels).not.toContain(NotificationChannel.EMAIL)
    }
  })

  // The asymmetry is the design: the client is asked, the pro is answered.
  it('routes each event to exactly one audience', () => {
    expect(
      NOTIFICATION_EVENT_DEFINITIONS[NotificationEventKey.CHART_ACCESS_REQUESTED]
        .supportedRecipients,
    ).toEqual(['CLIENT'])
    expect(
      NOTIFICATION_EVENT_DEFINITIONS[NotificationEventKey.CHART_ACCESS_GRANTED]
        .supportedRecipients,
    ).toEqual(['PRO'])
  })
})
