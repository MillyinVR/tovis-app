// The single place the claim-invite refusal copy is pinned.
//
// Before this module the two pro-facing doors each spelled these strings out,
// and #988 made them byte-identical — which is the state just before they
// drift. Asserting the copy HERE, once, is what makes the extraction worth
// anything: a reworded message now fails one test instead of silently meaning
// two different things to two callers who cannot tell the doors apart.

import { describe, expect, it } from 'vitest'

import { claimLinkRefusalResponse } from './claimInviteRefusals'

async function read(res: Response) {
  return {
    status: res.status,
    body: (await res.json()) as { error?: string; code?: string },
  }
}

describe('claimLinkRefusalResponse', () => {
  it('refuses an already-claimed client with a 409 and a stable code', async () => {
    const { status, body } = await read(
      claimLinkRefusalResponse('already_claimed'),
    )

    expect(status).toBe(409)
    expect(body.error).toBe('This client has already been claimed.')
    expect(body.code).toBe('ALREADY_CLAIMED')
  })

  it('refuses a revoked claim link with a 409 and a stable code', async () => {
    const { status, body } = await read(claimLinkRefusalResponse('revoked'))

    expect(status).toBe(409)
    expect(body.error).toBe('This client’s claim link was revoked.')
    expect(body.code).toBe('REVOKED')
  })

  // 409, not 400: both are conflicts with durable state, and neither is
  // something the caller can fix by retrying or by sending different input.
  it('never answers a refusal with a retryable status', async () => {
    for (const kind of ['already_claimed', 'revoked'] as const) {
      expect(claimLinkRefusalResponse(kind).status).toBe(409)
    }
  })

  // The apostrophe is a typographic ’ (U+2019), not an ASCII '. It has been
  // mangled by a careless edit before; pin the exact codepoint.
  it('keeps the typographic apostrophe in the revoked copy', async () => {
    const { body } = await read(claimLinkRefusalResponse('revoked'))

    expect(body.error).toContain('’')
    expect(body.error).not.toContain("'")
  })
})
