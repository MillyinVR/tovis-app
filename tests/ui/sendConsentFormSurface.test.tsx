/**
 * `SendConsentFormButton`'s select sits inside a `bg-bgPrimary` panel, so it
 * takes the kit's `raised` fill. It used to take `translucent`, and that was a
 * bug rather than a preference: `bg-bgPrimary/70` over `bg-bgPrimary` IS
 * `bg-bgPrimary`, so the control rendered at Δ=0 against its own panel with
 * only a 10%-alpha border to say it was there. Measured on the real page,
 * Δ 0 → 8.8 in dark and 3 → 16.8 in light.
 *
 * This is pinned because the surface is hard to reach by accident: it needs
 * `ENABLE_CLIENT_TECHNICAL_RECORD=1`, a `ConsentForm` row for the pro, and the
 * `?tab=technical` tab. Nobody is going to notice it going translucent again.
 *
 * The string is a LITERAL, not `controlClassName({ surface: 'raised' })` —
 * comparing the module with itself would stay green on exactly the change this
 * exists to catch (#914's lesson).
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import SendConsentFormButton from '@/app/pro/clients/[id]/SendConsentFormButton'
import type { ConsentFormOption } from '@/lib/consentForms/loader'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

// Typed against the real loader type rather than a hand-rolled shape — the
// first version of this fixture omitted `versionId` and vitest passed anyway,
// because a test cannot hold a TYPE. Only `tsc` caught it.
const FORMS: ConsentFormOption[] = [
  {
    formId: 'form_1',
    versionId: 'ver_1',
    version: 2,
    kind: 'PATCH_TEST',
    title: 'Patch test',
  },
]

describe('SendConsentFormButton field surface', () => {
  it('paints the select against its bg-bgPrimary panel, not into it', () => {
    const { container } = render(
      <SendConsentFormButton clientId="client_1" forms={FORMS} />,
    )

    const select = container.querySelector('select[aria-label="Form to send"]')
    expect(select).not.toBeNull()
    expect(select?.className).toBe(
      'border px-3 text-textPrimary placeholder:text-textSecondary/70 ' +
        'outline-none disabled:cursor-not-allowed disabled:opacity-60 ' +
        'rounded-xl border-surfaceGlass/10 bg-bgSecondary text-[13px] ' +
        'w-auto min-w-[200px] flex-1 py-2',
    )
  })

  // The regression, stated as itself: a translucent fill over this panel is the
  // panel's own colour.
  it('is never bg-bgPrimary or a translucent tint of it', () => {
    const { container } = render(
      <SendConsentFormButton clientId="client_1" forms={FORMS} />,
    )
    const cls =
      container.querySelector('select[aria-label="Form to send"]')?.className ??
      ''
    expect(cls).toContain('bg-bgSecondary')
    expect(cls).not.toContain('bg-bgPrimary')
  })

  // The box is the field's own and predates the surface; the kit must not
  // stretch it (`w-full` fights its flex basis) or grow it (`py-3`).
  it('keeps its own width behaviour and shorter box', () => {
    const { container } = render(
      <SendConsentFormButton clientId="client_1" forms={FORMS} />,
    )
    const cls =
      container.querySelector('select[aria-label="Form to send"]')?.className ??
      ''
    expect(cls).toContain('w-auto')
    expect(cls).not.toContain('w-full')
    expect(cls).toContain('py-2')
    expect(cls.split(' ')).not.toContain('py-3')
  })
})
