// RebookCard's three field labels, pinned.
//
// These are the only three of the fifteen migrated in this PR that could not be
// driven in a browser: the card lives at /client/rebook/[token], which needs a
// live AFTERCARE_ACCESS ClientActionToken, and minting one is a write to the dev
// DB. So they are PINNED here rather than seen — and this comment says so,
// because "it compiled" is not "it rendered".
//
// Two of the three sit behind a branch (`locationModes.length > 1`, and MOBILE
// with at least one saved address), so the props below exist to force both open;
// the test asserts each label is actually on screen before asserting its class.
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RebookCard } from './RebookCard'

const KIT_LABEL = 'text-xs font-black text-textSecondary'

const PROPS = {
  token: 'tok_test',
  professionalId: 'pro_1',
  serviceId: 'svc_1',
  timeZone: 'America/Los_Angeles',
  windowStartIso: null,
  windowEndIso: null,
  locationModes: [
    { type: 'SALON' as const, label: 'In salon', locationId: '', clientAddressId: null },
    { type: 'MOBILE' as const, label: 'Mobile', locationId: '', clientAddressId: null },
  ],
  initialLocationType: 'MOBILE' as const,
  savedAddresses: [
    { id: 'addr_1', label: 'Home', formattedAddress: '1 Main St', isDefault: true },
  ],
}

beforeEach(() => {
  // The card fetches availability on mount; an unstubbed fetch rejects in jsdom
  // and the failure would surface as a confusing unhandled rejection, not as a
  // label assertion.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ slots: [] }), { status: 200 })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RebookCard field labels', () => {
  it('renders all three on the kit FieldLabel, not the hand-written copy', () => {
    const { container, getByText } = render(<RebookCard {...PROPS} />)

    for (const text of ['Where', 'Service address', 'Pick a day']) {
      const el = getByText(text)
      expect(el, `"${text}" is not on screen`).toBeTruthy()
      // The kit class, exactly — `text-[12px]` here would mean the migration
      // silently reverted and the label box grew 2px back.
      expect(el.className).toContain('text-xs')
      expect(el.className).not.toContain('text-[12px]')
      expect(el.className).toContain('font-black')
      expect(el.className).toContain('text-textSecondary')
    }

    // "Where" and "Service address" keep the mb-1.5 they carried before the
    // migration — a caller className merged onto the kit string, not dropped.
    expect(getByText('Where').className).toBe(`${KIT_LABEL} mb-1.5`)
    expect(getByText('Service address').className).toBe(`${KIT_LABEL} mb-1.5`)

    // "Pick a day" is a <span> because its parent is already a <label>; a block
    // child there would break the flex column.
    expect(getByText('Pick a day').tagName).toBe('SPAN')
    expect(getByText('Pick a day').className).toBe(KIT_LABEL)

    // And no LABEL-shaped element in this card still wears the hand-written
    // form. Two exclusions, both load-bearing:
    //
    //  · the colour token. `text-[12px] font-black` alone also describes this
    //    card's address rows (`text-textPrimary`), which are not FieldLabel
    //    forks.
    //  · the element role. The inactive segmented mode button composes
    //    `text-textSecondary` from a conditional, so it matches all three
    //    tokens at runtime while being a <button>. Worth knowing beyond this
    //    file: `docs/cleanup-harness/labels.mjs` scans string LITERALS, so a
    //    class string assembled from a ternary is invisible to it — the
    //    remaining count it reports is a floor, not a total.
    const stragglers = Array.from(
      container.querySelectorAll('div, span, label'),
    ).filter((el) => {
      const c = ` ${el.className} `
      return (
        c.includes(' text-[12px] ') &&
        c.includes(' font-black ') &&
        c.includes(' text-textSecondary ')
      )
    })
    expect(stragglers.map((el) => el.textContent)).toEqual([])
  })
})
