import { describe, expect, it } from 'vitest'

import {
  applyPreferredChannel,
  deriveActivePreference,
  type PreferencesPayload,
} from './NotificationPreferencesForm'

function makePayload(): PreferencesPayload {
  return {
    quietHours: { enabled: false, startMinutes: 0, endMinutes: 0 },
    categories: [
      {
        key: 'cat',
        label: 'Cat',
        description: '',
        events: [
          {
            eventKey: 'evt_dual',
            label: 'Dual',
            supportedChannels: ['IN_APP', 'EMAIL', 'SMS'],
          },
          {
            eventKey: 'evt_email_only',
            label: 'Email only',
            supportedChannels: ['IN_APP', 'EMAIL'],
          },
          {
            eventKey: 'evt_inapp_only',
            label: 'In-app only',
            supportedChannels: ['IN_APP'],
          },
          {
            eventKey: 'evt_payment',
            label: 'Payment receipt',
            supportedChannels: ['IN_APP', 'EMAIL', 'SMS'],
            emailLocked: true,
          },
        ],
      },
    ],
    events: {
      evt_dual: { inAppEnabled: true, smsEnabled: true, emailEnabled: true },
      evt_email_only: {
        inAppEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
      },
      evt_inapp_only: {
        inAppEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
      },
      evt_payment: {
        inAppEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
      },
    },
  }
}

describe('applyPreferredChannel', () => {
  it('EMAIL: enables email and disables SMS only on dual-channel events', () => {
    const next = applyPreferredChannel(makePayload(), 'EMAIL')
    expect(next.evt_dual).toEqual({
      inAppEnabled: true,
      emailEnabled: true,
      smsEnabled: false,
    })
  })

  it('TEXT: enables SMS and disables email only on dual-channel events', () => {
    const next = applyPreferredChannel(makePayload(), 'SMS')
    expect(next.evt_dual).toEqual({
      inAppEnabled: true,
      smsEnabled: true,
      emailEnabled: false,
    })
  })

  it('never silences an email-only event when TEXT is chosen', () => {
    const next = applyPreferredChannel(makePayload(), 'SMS')
    // No SMS alternative, so email stays on — the client still gets it.
    expect(next.evt_email_only?.emailEnabled).toBe(true)
  })

  it('keeps email on for an email-locked (critical) event under TEXT', () => {
    const next = applyPreferredChannel(makePayload(), 'SMS')
    // Critical events always email — never silenced by the primary-channel pick.
    expect(next.evt_payment?.emailEnabled).toBe(true)
  })

  it('always keeps in-app enabled', () => {
    const email = applyPreferredChannel(makePayload(), 'EMAIL')
    const sms = applyPreferredChannel(makePayload(), 'SMS')
    for (const key of [
      'evt_dual',
      'evt_email_only',
      'evt_inapp_only',
      'evt_payment',
    ]) {
      expect(email[key]?.inAppEnabled).toBe(true)
      expect(sms[key]?.inAppEnabled).toBe(true)
    }
  })
})

describe('deriveActivePreference', () => {
  it('returns EMAIL when every dual event is email-on/sms-off', () => {
    const payload = makePayload()
    payload.events = applyPreferredChannel(payload, 'EMAIL')
    expect(deriveActivePreference(payload)).toBe('EMAIL')
  })

  it('returns SMS when every dual event is sms-on/email-off', () => {
    const payload = makePayload()
    payload.events = applyPreferredChannel(payload, 'SMS')
    expect(deriveActivePreference(payload)).toBe('SMS')
  })

  it('returns null (Custom) for a mixed state', () => {
    const payload = makePayload()
    // Leave both channels on — neither a pure Email nor pure Text choice.
    expect(deriveActivePreference(payload)).toBeNull()
  })
})
