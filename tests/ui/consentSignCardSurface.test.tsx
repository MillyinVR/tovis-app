/**
 * `ConsentSignCard` is the one control in either fill family that could not be
 * driven in a browser: it needs a live client-facing consent-signature token,
 * and minting one is a DB write against a client-side flow. So it is PINNED
 * here rather than seen — the same treatment #918 gave `RebookCard`.
 *
 * What this can and cannot prove. It proves the call site asks for the
 * `translucent` surface and that the surface reaches the DOM. It does not prove
 * anything about how the page paints; that rests on the rendered A/B, where the
 * identical migration measured border-token-only on six sibling `translucent`
 * controls across four screens in both modes.
 *
 * The string is pinned as a LITERAL, deliberately. Asserting
 * `toBe(controlClassName({ surface: 'translucent' }))` would compare the module
 * with itself and stay green on exactly the restyle this exists to catch —
 * #914's lesson, and it cost a whole PR to learn.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import { ConsentSignCard } from '@/app/client/consent/[token]/ConsentSignCard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

describe('ConsentSignCard field surface', () => {
  it('puts its name field on the kit translucent surface', () => {
    const { container } = render(
      <ConsentSignCard
        token="tok_test"
        formTitle="Patch test"
        professionalLabel="Noor"
      />,
    )

    const input = container.querySelector('input[autocomplete="name"]')
    expect(input).not.toBeNull()
    expect(input?.className).toBe(
      'w-full border px-3 text-textPrimary ' +
        'placeholder:text-textSecondary/70 outline-none ' +
        'disabled:cursor-not-allowed disabled:opacity-60 rounded-xl ' +
        'border-surfaceGlass/10 bg-bgPrimary/70 py-3 text-[13px]',
    )
  })

  // The fill is the whole reason this control is not on `solid`: it sits on a
  // `bg-bgSecondary` card, and `solid` would push it the wrong way.
  it('is translucent, not solid', () => {
    const { container } = render(
      <ConsentSignCard
        token="tok_test"
        formTitle="Patch test"
        professionalLabel="Noor"
      />,
    )
    const cls = container.querySelector('input[autocomplete="name"]')?.className
    expect(cls).toContain('bg-bgPrimary/70')
    expect(cls?.split(' ')).not.toContain('bg-bgPrimary')
  })
})
