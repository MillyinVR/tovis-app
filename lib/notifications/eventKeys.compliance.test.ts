// lib/notifications/eventKeys.compliance.test.ts
//
// TCPA/CTIA compliance guard: this repo sends no promotional/marketing SMS
// today (lib/transactionalSmsPolicy.ts's TRANSACTIONAL_SMS_USE_CASES is the
// full allowlist; every non-transactional event definition below carries an
// inline comment saying so). These two invariants are what makes that true —
// this test exists so a future event definition can't silently regress them:
//
//   1. A non-transactional ("promotional-adjacent") event can never bypass
//      quiet hours. Quiet hours (22:00-08:00 recipient-local by default,
//      stricter than TCPA's 8am-9pm safe-harbor window) is the ONE compliance
//      control this codebase applies to every SMS/EMAIL send; a bypass flag
//      on a non-transactional event would let a re-engagement nudge ignore
//      it.
//   2. A non-transactional event can never include SMS in its default channel
//      set. Sending promotional SMS requires prior express written consent
//      and in-message opt-out language this codebase does not yet capture
//      (see lib/transactionalSmsPolicy.ts) — only the 5 allowlisted
//      transactional use cases (verification, confirmations, reminders,
//      reschedules, cancellations) are covered by the consent captured at
//      signup.
//
// If a real product need adds promotional SMS, that's a deliberate,
// consent-model change — not something that should happen by accident when
// someone adds a new NotificationEventKey and copies a neighboring channel
// set.

import { describe, expect, it } from 'vitest'
import { NotificationChannel } from '@prisma/client'

import { NOTIFICATION_EVENT_DEFINITIONS } from './eventKeys'

describe('lib/notifications/eventKeys — SMS compliance invariants', () => {
  const definitions = Object.values(NOTIFICATION_EVENT_DEFINITIONS)

  it('sanity: covers every defined event key', () => {
    expect(definitions.length).toBeGreaterThan(0)
  })

  it.each(definitions.map((definition) => [definition.key, definition] as const))(
    '%s: non-transactional events never bypass quiet hours',
    (_key, definition) => {
      if (!definition.transactional) {
        expect(definition.allowQuietHoursBypass).toBe(false)
      }
    },
  )

  it.each(definitions.map((definition) => [definition.key, definition] as const))(
    '%s: non-transactional events never include SMS in any recipient channel set',
    (_key, definition) => {
      if (definition.transactional) return

      for (const channels of Object.values(definition.defaultChannelsByRecipient)) {
        expect(channels).not.toContain(NotificationChannel.SMS)
      }
    },
  )
})
