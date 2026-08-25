// lib/proCapabilities/resolve.test.ts
//
// Drives the REAL env vars rather than mocking the flag helpers. The bug
// this guards against is a capability that reports the wrong flag — which a
// mocked helper cannot catch, because the mock would be wired to whatever the
// implementation happens to call.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveProCapabilities } from './resolve'

const FLAG_ENV_KEYS = [
  'ENABLE_NO_SHOW_PROTECTION',
  'ENABLE_PRO_MIGRATION',
  'ENABLE_RECURRING_APPOINTMENTS',
] as const

const ORIGINALS: Record<(typeof FLAG_ENV_KEYS)[number], string | undefined> = {
  ENABLE_NO_SHOW_PROTECTION: process.env.ENABLE_NO_SHOW_PROTECTION,
  ENABLE_PRO_MIGRATION: process.env.ENABLE_PRO_MIGRATION,
  ENABLE_RECURRING_APPOINTMENTS: process.env.ENABLE_RECURRING_APPOINTMENTS,
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
    })
  })

  it('reports all on when all flags are on', () => {
    setFlags('1', 'true', 'yes')
    expect(resolveProCapabilities()).toEqual({
      noShowFees: true,
      importFromAnotherApp: true,
      recurringAppointments: true,
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
    })

    setFlags('1', undefined, 'true')
    expect(resolveProCapabilities()).toEqual({
      noShowFees: true,
      importFromAnotherApp: false,
      recurringAppointments: true,
    })

    setFlags(undefined, undefined, '1')
    expect(resolveProCapabilities()).toEqual({
      noShowFees: false,
      importFromAnotherApp: false,
      recurringAppointments: true,
    })
  })

  it('treats a non-truthy value as off (matching the flag helpers)', () => {
    setFlags('maybe', '0', 'false')
    expect(resolveProCapabilities()).toEqual({
      noShowFees: false,
      importFromAnotherApp: false,
      recurringAppointments: false,
    })
  })
})
