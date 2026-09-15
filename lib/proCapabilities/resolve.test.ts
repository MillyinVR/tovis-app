// lib/proCapabilities/resolve.test.ts
//
// Drives the REAL env vars rather than mocking the flag helpers. The bug
// this guards against is a capability that reports the wrong flag — which a
// mocked helper cannot catch, because the mock would be wired to whatever the
// implementation happens to call.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TECHNICAL_RECORD_PRO_ALLOWLIST } from '@/lib/clients/technicalRecord'

import { resolveProCapabilities } from './resolve'

const FLAG_ENV_KEYS = [
  'ENABLE_NO_SHOW_PROTECTION',
  'ENABLE_PRO_MIGRATION',
  'ENABLE_RECURRING_APPOINTMENTS',
  'ENABLE_CLIENT_TECHNICAL_RECORD',
] as const

const ORIGINALS: Record<(typeof FLAG_ENV_KEYS)[number], string | undefined> = {
  ENABLE_NO_SHOW_PROTECTION: process.env.ENABLE_NO_SHOW_PROTECTION,
  ENABLE_PRO_MIGRATION: process.env.ENABLE_PRO_MIGRATION,
  ENABLE_RECURRING_APPOINTMENTS: process.env.ENABLE_RECURRING_APPOINTMENTS,
  ENABLE_CLIENT_TECHNICAL_RECORD: process.env.ENABLE_CLIENT_TECHNICAL_RECORD,
}

function setFlag(key: (typeof FLAG_ENV_KEYS)[number], value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

function setFlags(
  noShow: string | undefined,
  migration: string | undefined,
  recurring: string | undefined = undefined,
) {
  setFlag('ENABLE_NO_SHOW_PROTECTION', noShow)
  setFlag('ENABLE_PRO_MIGRATION', migration)
  setFlag('ENABLE_RECURRING_APPOINTMENTS', recurring)
  setFlag('ENABLE_CLIENT_TECHNICAL_RECORD', undefined)
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(() => {
  setFlags(undefined, undefined)
})

afterEach(() => {
  FLAG_ENV_KEYS.forEach((key) => restore(key, ORIGINALS[key]))
})

describe('resolveProCapabilities', () => {
  it('reports every feature off when no flag is set (prod today)', () => {
    expect(resolveProCapabilities()).toEqual({
      noShowFees: false,
      importFromAnotherApp: false,
      recurringAppointments: false,
      clientTechnicalRecord: false,
    })
  })

  it('reports all on when all flags are on', () => {
    setFlags('1', 'true', 'yes')
    expect(resolveProCapabilities()).toEqual({
      noShowFees: true,
      importFromAnotherApp: true,
      recurringAppointments: true,
      clientTechnicalRecord: false,
    })
  })

  // 🔴 The assertion that catches a crossed wire: with ONLY one flag on, a
  // resolver that read the wrong helper for any key comes back inverted. All-on
  // / all-off cases alone would pass through that bug.
  it('keeps the capabilities independent of each other', () => {
    setFlags(undefined, '1')
    expect(resolveProCapabilities()).toEqual({
      noShowFees: false,
      importFromAnotherApp: true,
      recurringAppointments: false,
      clientTechnicalRecord: false,
    })

    setFlags('1', undefined, 'true')
    expect(resolveProCapabilities()).toEqual({
      noShowFees: true,
      importFromAnotherApp: false,
      recurringAppointments: true,
      clientTechnicalRecord: false,
    })

    setFlags(undefined, undefined, '1')
    expect(resolveProCapabilities()).toEqual({
      noShowFees: false,
      importFromAnotherApp: false,
      recurringAppointments: true,
      clientTechnicalRecord: false,
    })
  })

  it('treats a non-truthy value as off (matching the flag helpers)', () => {
    setFlags('maybe', '0', 'false')
    expect(resolveProCapabilities()).toEqual({
      noShowFees: false,
      importFromAnotherApp: false,
      recurringAppointments: false,
      clientTechnicalRecord: false,
    })
  })
})

// The one capability that is NOT a pure flag readout. Its gate is the global
// flag OR a per-pro allowlist, so the id the route passes in is load-bearing:
// resolving it from the env alone would tell an allowlisted pro to hide the
// consent-form library they can actually use.
describe('resolveProCapabilities — clientTechnicalRecord', () => {
  // Read from the allowlist itself rather than a pasted id: the array is
  // documented as something to EMPTY before the feature opens up, and a test
  // holding its own copy would keep passing after that happened.
  const allowlisted = TECHNICAL_RECORD_PRO_ALLOWLIST[0]

  it('is off for a pro who is neither allowlisted nor covered by the flag', () => {
    expect(resolveProCapabilities('cnot-on-the-list').clientTechnicalRecord).toBe(
      false,
    )
  })

  it('is on for an allowlisted pro while the global flag is off', () => {
    // Skips itself rather than asserting on an empty list — see the comment on
    // TECHNICAL_RECORD_PRO_ALLOWLIST: emptying it is the intended way to
    // re-darken the feature, and that must not read as a failure here.
    if (!allowlisted) return
    expect(resolveProCapabilities(allowlisted).clientTechnicalRecord).toBe(true)
  })

  it('is on for every pro once the global flag is on', () => {
    setFlag('ENABLE_CLIENT_TECHNICAL_RECORD', '1')
    expect(resolveProCapabilities('cnot-on-the-list').clientTechnicalRecord).toBe(
      true,
    )
  })

  it('is off with no pro in hand while the flag is off', () => {
    expect(resolveProCapabilities().clientTechnicalRecord).toBe(false)
  })
})
