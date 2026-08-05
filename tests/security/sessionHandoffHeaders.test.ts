// tests/security/sessionHandoffHeaders.test.ts
//
// Regression guard for a defect that ONLY showed up when the endpoint was
// actually driven over HTTP.
//
// The exchange route sets `Referrer-Policy: no-referrer` on its own response.
// It never reached the wire: `next.config.ts` applies `securityHeaders` to
// `/(.*)`, and that rewrote it back to `strict-origin-when-cross-origin`. The
// route-handler unit test asserted the header and passed, because it inspects
// the Response object before Next's header pipeline ever touches it.
//
// So this test reads the CONFIG, which is the thing that actually decides what
// ships. If someone removes the scoped override, this goes red.

import { describe, expect, it } from 'vitest'

import nextConfig from '../../next.config'

const HANDOFF_SOURCE = '/api/v1/auth/session-handoff/:path*'

async function headerRules() {
  if (typeof nextConfig.headers !== 'function') {
    throw new Error('next.config no longer defines headers()')
  }
  return nextConfig.headers()
}

function valueOf(
  headers: { key: string; value: string }[],
  key: string,
): string | undefined {
  return headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value
}

describe('session hand-off security headers', () => {
  it('scopes Referrer-Policy: no-referrer to the hand-off endpoint', async () => {
    const rules = await headerRules()
    const rule = rules.find((r) => r.source === HANDOFF_SOURCE)

    expect(
      rule,
      `no header rule for ${HANDOFF_SOURCE} — the token would inherit the global Referrer-Policy`,
    ).toBeDefined()
    expect(valueOf(rule!.headers, 'Referrer-Policy')).toBe('no-referrer')
  })

  it('declares that override AFTER the global rule, so it actually wins', async () => {
    // Next applies matching rules in order and the later one wins. If the
    // override were declared first, the global `/(.*)` rule would overwrite it
    // and this whole thing would be decorative — which is exactly the bug that
    // existed before.
    const rules = await headerRules()
    const globalIndex = rules.findIndex((r) => r.source === '/(.*)')
    const handoffIndex = rules.findIndex((r) => r.source === HANDOFF_SOURCE)

    expect(globalIndex).toBeGreaterThanOrEqual(0)
    expect(handoffIndex).toBeGreaterThan(globalIndex)
  })

  it('still carries every other global security header on that path', async () => {
    // The override must not become a hole: narrowing Referrer-Policy must not
    // quietly drop nosniff / DENY / HSTS for this endpoint.
    const rules = await headerRules()
    const globalRule = rules.find((r) => r.source === '/(.*)')
    const handoffRule = rules.find((r) => r.source === HANDOFF_SOURCE)

    for (const header of globalRule!.headers) {
      if (header.key === 'Referrer-Policy') continue
      expect(
        valueOf(handoffRule!.headers, header.key),
        `${header.key} was dropped for the hand-off endpoint`,
      ).toBe(header.value)
    }
  })

  it('leaves the global Referrer-Policy alone for everything else', async () => {
    const rules = await headerRules()
    const globalRule = rules.find((r) => r.source === '/(.*)')

    expect(valueOf(globalRule!.headers, 'Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    )
  })
})
