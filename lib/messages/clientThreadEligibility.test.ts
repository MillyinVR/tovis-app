import { describe, expect, it } from 'vitest'

import { clientCanBeMessaged } from './clientThreadEligibility'

// The rule that decides BOTH the 409 CLIENT_UNCLAIMED in resolveMessageThread
// and `client.canMessage` on the pro booking detail. It exists so those two
// cannot drift — before it, iOS offered a "Message client" button that the
// resolve route then refused, and the failure was invisible.
describe('clientCanBeMessaged', () => {
  it('allows a claimed client (the profile has a user account)', () => {
    expect(clientCanBeMessaged({ userId: 'user_1' })).toBe(true)
  })

  it('refuses an unclaimed client — a pro-created or imported profile', () => {
    expect(clientCanBeMessaged({ userId: null })).toBe(false)
    expect(clientCanBeMessaged({ userId: undefined })).toBe(false)
  })

  it('refuses a missing client rather than throwing', () => {
    // The booking DTO reads through an optional relation; a null here must
    // degrade to "no button", never to a crash.
    expect(clientCanBeMessaged(null)).toBe(false)
    expect(clientCanBeMessaged(undefined)).toBe(false)
  })

  it('treats an empty-string userId as unclaimed', () => {
    // Defensive: an empty id is not an account, and Boolean('') is false —
    // pinned so a future truthiness change can't silently offer the button.
    expect(clientCanBeMessaged({ userId: '' })).toBe(false)
  })
})
