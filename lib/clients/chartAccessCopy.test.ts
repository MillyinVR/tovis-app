// lib/clients/chartAccessCopy.test.ts
import { describe, expect, it } from 'vitest'

import type { ClientVisibilityResult } from '@/lib/clientVisibility'

import { chartRefusal } from './chartAccessCopy'

function visibility(
  overrides: Partial<ClientVisibilityResult>,
): ClientVisibilityResult {
  return {
    canViewClient: false,
    canContactClient: false,
    reason: 'NONE',
    accessUntil: null,
    ...overrides,
  }
}

describe('chartRefusal', () => {
  // The pro most likely to hit W5's refusal is one mid-conversation with the
  // client. iOS passes the server's copy straight through, so a flat
  // "Forbidden." is what they would read about someone they are messaging.
  it('tells a contactable pro that the chart is not shared, and that they can ask', () => {
    const refusal = chartRefusal(
      visibility({ canContactClient: true, reason: 'ACTIVE_THREAD' }),
    )

    expect(refusal.code).toBe('CHART_NOT_SHARED')
    expect(refusal.message).toContain('ask them')
    expect(refusal.message).not.toBe('Forbidden.')
  })

  // 🔴 The other direction is a privacy rule, not a UX one: a pro with NO
  // relationship must not learn that this client id exists.
  it('says nothing to a pro with no relationship at all', () => {
    const refusal = chartRefusal(visibility({ canContactClient: false }))

    expect(refusal.code).toBe('NO_CLIENT_RELATIONSHIP')
    expect(refusal.message).toBe('Client not found.')
  })

  // This runs on a refusal path. A throw here turns a clean 403 into a 500 —
  // the one response that tells the caller nothing. The real gate always returns
  // a visibility, so this is a backstop, not an expected input.
  it('fails closed rather than throwing on a missing visibility', () => {
    for (const bad of [null, undefined]) {
      const refusal = chartRefusal(bad, 404)
      expect(refusal.status).toBe(404)
      expect(refusal.code).toBe('NO_CLIENT_RELATIONSHIP')
    }
  })

  // Each route already chose 403 or 404 and that contract is not this helper's
  // to change — it changes the copy, not the status.
  it('preserves the calling route’s status on both branches', () => {
    expect(chartRefusal(visibility({ canContactClient: true }), 404).status).toBe(404)
    expect(chartRefusal(visibility({ canContactClient: true }), 403).status).toBe(403)
    expect(chartRefusal(visibility({}), 404).status).toBe(404)
    expect(chartRefusal(visibility({}), 403).status).toBe(403)
  })
})
