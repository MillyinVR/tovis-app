// lib/proCapabilities/resolve.test.ts
//
// Drives the REAL env vars rather than mocking the two flag helpers. The bug
// this guards against is a capability that reports the wrong flag — which a
// mocked helper cannot catch, because the mock would be wired to whatever the
// implementation happens to call.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveProCapabilities } from './resolve'

const ORIGINAL_NO_SHOW = process.env.ENABLE_NO_SHOW_PROTECTION
const ORIGINAL_MIGRATION = process.env.ENABLE_PRO_MIGRATION

function setFlags(noShow: string | undefined, migration: string | undefined) {
  if (noShow === undefined) delete process.env.ENABLE_NO_SHOW_PROTECTION
  else process.env.ENABLE_NO_SHOW_PROTECTION = noShow

  if (migration === undefined) delete process.env.ENABLE_PRO_MIGRATION
  else process.env.ENABLE_PRO_MIGRATION = migration
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(() => {
  setFlags(undefined, undefined)
})

afterEach(() => {
  restore('ENABLE_NO_SHOW_PROTECTION', ORIGINAL_NO_SHOW)
  restore('ENABLE_PRO_MIGRATION', ORIGINAL_MIGRATION)
})

describe('resolveProCapabilities', () => {
  it('reports both features off when neither flag is set (prod today)', () => {
    expect(resolveProCapabilities()).toEqual({
      noShowFees: false,
      importFromAnotherApp: false,
    })
  })

  it('reports both on when both flags are on', () => {
    setFlags('1', 'true')
    expect(resolveProCapabilities()).toEqual({
      noShowFees: true,
      importFromAnotherApp: true,
    })
  })

  // 🔴 The assertion that catches a crossed wire: with ONLY the migration flag
  // on, a resolver that read the wrong helper for either key comes back
  // inverted. Two all-on / all-off cases alone would pass through that bug.
  it('keeps the two capabilities independent', () => {
    setFlags(undefined, '1')
    expect(resolveProCapabilities()).toEqual({
      noShowFees: false,
      importFromAnotherApp: true,
    })

    setFlags('1', undefined)
    expect(resolveProCapabilities()).toEqual({
      noShowFees: true,
      importFromAnotherApp: false,
    })
  })

  it('treats a non-truthy value as off (matching the flag helpers)', () => {
    setFlags('maybe', '0')
    expect(resolveProCapabilities()).toEqual({
      noShowFees: false,
      importFromAnotherApp: false,
    })
  })
})
