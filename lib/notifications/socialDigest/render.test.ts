import { NotificationEventKey } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  renderSocialDigestEmail,
  type SocialDigestEmailModel,
} from './render'
import { summarizeDigestRows } from './summary'

function baseModel(
  overrides: Partial<SocialDigestEmailModel> = {},
): SocialDigestEmailModel {
  const summary = summarizeDigestRows([
    {
      eventKey: NotificationEventKey.LOOK_LIKED,
      title: 'Your look was liked',
      href: '/looks/abc',
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
    },
    {
      eventKey: NotificationEventKey.CLIENT_FOLLOW,
      title: 'Someone followed you',
      href: '/u/someone',
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
    },
  ])

  return {
    greetingName: 'Tori',
    summary,
    recent: [
      { title: 'Your look was liked', href: 'https://app.test/looks/abc' },
      { title: 'Someone followed you', href: 'https://app.test/u/someone' },
    ],
    topLooks: [
      {
        id: 'look1',
        caption: 'Balayage magic',
        thumbUrl: 'https://cdn.test/thumb.jpg',
        proName: 'Studio Nine',
        href: 'https://app.test/looks/look1',
      },
    ],
    managePreferencesUrl: 'https://app.test/pro/notifications/settings',
    browseLooksUrl: 'https://app.test/looks',
    ...overrides,
  }
}

describe('renderSocialDigestEmail', () => {
  it('injects the brand name into subject and footer, never a hardcoded brand', () => {
    const rendered = renderSocialDigestEmail({
      model: baseModel(),
      brandName: 'Acme Beauty',
    })

    expect(rendered.subject.startsWith('Acme Beauty:')).toBe(true)
    expect(rendered.text).toContain('Sent by Acme Beauty')
    expect(rendered.html).toContain('Sent by Acme Beauty')
    expect(rendered.subject).not.toContain('TOVIS')
  })

  it('greets by name when known and generically otherwise', () => {
    expect(
      renderSocialDigestEmail({ model: baseModel(), brandName: 'B' }).text,
    ).toContain('Hi Tori,')

    expect(
      renderSocialDigestEmail({
        model: baseModel({ greetingName: null }),
        brandName: 'B',
      }).text,
    ).toContain('Hi there,')
  })

  it('renders recent activity + top looks with their absolute links', () => {
    const rendered = renderSocialDigestEmail({
      model: baseModel(),
      brandName: 'B',
    })

    expect(rendered.html).toContain('https://app.test/looks/abc')
    expect(rendered.html).toContain('Top looks this week')
    expect(rendered.html).toContain('https://cdn.test/thumb.jpg')
    expect(rendered.html).toContain('Studio Nine')
    expect(rendered.html).toContain(
      'https://app.test/pro/notifications/settings',
    )
    expect(rendered.text).toContain('Manage your email preferences')
  })

  it('escapes HTML in user-supplied text', () => {
    const rendered = renderSocialDigestEmail({
      model: baseModel({
        recent: [{ title: '<script>x</script>', href: 'https://app.test/x' }],
      }),
      brandName: 'B',
    })

    expect(rendered.html).not.toContain('<script>x</script>')
    expect(rendered.html).toContain('&lt;script&gt;')
  })

  it('omits the top-looks and recent blocks when empty', () => {
    const rendered = renderSocialDigestEmail({
      model: baseModel({ topLooks: [], recent: [] }),
      brandName: 'B',
    })

    expect(rendered.html).not.toContain('Top looks this week')
    expect(rendered.html).not.toContain('Recent activity')
  })
})
