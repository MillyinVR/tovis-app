// The titled glass card was declared twice — the client booking detail page and
// the public consultation token page — with the same surface and header.
//
// The booking page was A/B'd on the running app (3 real bookings × both modes,
// 8/3/8 sections each, zero computed differences). The consultation page could
// NOT be: every consult table in the local dev DB is empty
// (`consultationApproval`, `bookingConsultation`, … all 0 rows), so the route has
// no reachable state. Its string is pinned here instead — the same call
// `authPrimaryButton.test.tsx` made for the verify-phone <Link>.
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import SectionCard from '@/app/client/_components/SectionCard'

/** What each page's own declaration put on the <section>. */
const SECTION_BEFORE =
  'rounded-card border border-textPrimary/10 p-4 shadow-[0_14px_48px_rgb(var(--shadow-color)/0.18)] tovis-glass'

function renderCard(props: Partial<Parameters<typeof SectionCard>[0]> = {}) {
  const { container } = render(
    <SectionCard title="Proposal" {...props}>
      <p>body</p>
    </SectionCard>,
  )
  const section = container.querySelector('section')
  if (!section) throw new Error('no <section> rendered')
  return section
}

describe('client SectionCard', () => {
  it('reproduces the surface BOTH pages were carrying', () => {
    const emitted = new Set(renderCard().className.split(' ').filter(Boolean))
    const inherited = new Set(SECTION_BEFORE.split(' '))

    expect([...inherited].filter((c) => !emitted.has(c))).toEqual([])
    expect([...emitted].filter((c) => !inherited.has(c))).toEqual([])
  })

  // The ONE way the two declarations differed. Preserved rather than decided —
  // flattening it is the phase-4 failure mode (consolidating onto a canonical
  // silently swapped every call site's fallback copy).
  it('keeps the 4px content gap each page actually shipped', () => {
    expect(renderCard().lastElementChild?.className).toBe('mt-3')
    expect(renderCard({ gap: 'roomy' }).lastElementChild?.className).toBe('mt-4')
  })

  it('defaults to the booking page`s gap, which is the majority of call sites', () => {
    expect(renderCard().lastElementChild?.className).toBe(
      renderCard({ gap: 'tight' }).lastElementChild?.className,
    )
  })

  it('renders the header exactly as both pages did', () => {
    const section = renderCard({ subtitle: 'Review the recommended services' })
    const title = section.querySelector('div > div > div')
    expect(title?.className).toBe('text-[13px] font-black text-textPrimary')
    expect(title?.textContent).toBe('Proposal')

    const subtitle = title?.nextElementSibling
    expect(subtitle?.className).toBe(
      'mt-0.5 text-[12px] font-semibold text-textSecondary',
    )
  })

  it('omits the subtitle and the right slot when not given, as both pages did', () => {
    const section = renderCard()
    // header row holds ONLY the title column
    expect(section.firstElementChild?.children.length).toBe(1)

    const withRight = renderCard({ right: <span>total</span> })
    expect(withRight.firstElementChild?.children.length).toBe(2)
    expect(withRight.firstElementChild?.lastElementChild?.className).toBe('shrink-0')
  })

  // Only the booking page passed one; it must still reach the <section>.
  it('merges a caller className onto the section', () => {
    expect(renderCard({ className: 'mt-6' }).className).toContain('mt-6')
  })
})
