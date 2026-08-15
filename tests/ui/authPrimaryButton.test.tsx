// The auth hero CTA had three copies of one class string: the shared component,
// a private copy in verify-phone, and a <Link> in verify-phone wearing the same
// styling by hand. Consolidating them is only safe if the surviving string still
// emits what each copy emitted.
//
// The button copies were A/B'd on the running app (login, signup ×3,
// forgot-password, verify-phone, both modes — no computed-style differences).
// The <Link> could NOT be: it only renders once the phone is already verified,
// which needs a live verification session. So its string is pinned here instead.
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import PrimaryButton, {
  primaryButtonClassName,
} from '@/app/(auth)/_components/PrimaryButton'

/** What the <Link href={next}>Continue</Link> in verify-phone used to carry. */
const LINK_CLASSES_BEFORE = [
  'relative inline-flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2.5 text-sm font-black transition',
  'border border-accentPrimary/35',
  'bg-accentPrimary/26 text-textPrimary',
  'hover:bg-accentPrimary/30 hover:border-accentPrimary/45',
  'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
].join(' ')

describe('auth PrimaryButton', () => {
  it('reproduces the class set the verify-phone <Link> was carrying', () => {
    const emitted = new Set(primaryButtonClassName().split(' '))
    const inherited = new Set(LINK_CLASSES_BEFORE.split(' '))

    // Nothing the link had may go missing.
    expect([...inherited].filter((c) => !emitted.has(c))).toEqual([])

    // And the only additions are inert on an <a>: `group` is a marker class with
    // no styles of its own, and an anchor is already `cursor: pointer` per the UA
    // sheet. Neither paints anything new.
    expect([...emitted].filter((c) => !inherited.has(c)).sort()).toEqual([
      'cursor-pointer',
      'group',
    ])
  })

  it('drops the hover states when disabled, instead of relying on :enabled', () => {
    const enabled = primaryButtonClassName()
    const disabled = primaryButtonClassName({ disabled: true })

    expect(enabled).toContain('hover:bg-accentPrimary/30')
    expect(disabled).not.toContain('hover:bg-accentPrimary/30')
    expect(disabled).toContain('opacity-65')

    // `hover:enabled:` never matched an <a>, which is why the link copy had to
    // spell its hover states out by hand. Nothing should reintroduce it.
    expect(enabled).not.toContain('enabled:')
    expect(disabled).not.toContain('enabled:')
  })

  it('gates the shimmer on withArrow, and keeps the arrow out of the a11y name', () => {
    expect(primaryButtonClassName()).not.toContain('before:bg-[linear-gradient')
    expect(primaryButtonClassName({ withArrow: true })).toContain(
      'before:bg-[linear-gradient',
    )

    const { getByRole } = render(<PrimaryButton withArrow>Verify phone</PrimaryButton>)
    // The trailing → and the shimmer rule are decorative; the name must not move.
    expect(getByRole('button').textContent).toContain('→')
    expect(getByRole('button', { name: 'Verify phone' })).toBeTruthy()
  })

  it('disables the button for either reason, and dims it for both', () => {
    for (const props of [{ loading: true }, { disabled: true }]) {
      const { container } = render(<PrimaryButton {...props}>Go</PrimaryButton>)
      const button = container.querySelector('button')
      expect(button?.disabled).toBe(true)
      // verify-phone's copy dimmed on `loading` only, so a button disabled for
      // any other reason stayed at full strength while being unclickable.
      expect(button?.className).toContain('opacity-65')
    }
  })
})
