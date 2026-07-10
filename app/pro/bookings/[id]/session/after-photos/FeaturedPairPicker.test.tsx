import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

// next/link → a plain anchor so we can read the live href.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => React.createElement('a', { href, ...rest }, children),
}))

// ClickableMedia opens a fullscreen viewer we don't care about here — stub it to
// a lightweight box so the test focuses on the Feature pills + CTA wiring.
vi.mock('@/app/_components/media/ClickableMedia', () => ({
  default: ({
    children,
    alt,
  }: {
    children?: React.ReactNode
    alt?: string
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'clickable-media', 'aria-label': alt },
      children,
    ),
}))

import FeaturedPairPicker, {
  type FeaturedPickerItem,
} from './FeaturedPairPicker'

const AFTERCARE_HREF = '/pro/bookings/booking_1/aftercare'

function img(id: string): FeaturedPickerItem {
  return { id, mediaType: 'IMAGE', caption: null, renderUrl: `/s/${id}.jpg`, renderThumbUrl: null }
}

function vid(id: string): FeaturedPickerItem {
  return { id, mediaType: 'VIDEO', caption: null, renderUrl: `/s/${id}.mp4`, renderThumbUrl: null }
}

function continueHref(): string {
  return screen.getByRole('link', { name: /continue to aftercare/i }).getAttribute('href') ?? ''
}

function renderPicker(overrides?: {
  beforeItems?: FeaturedPickerItem[]
  afterItems?: FeaturedPickerItem[]
  initialBeforeId?: string | null
  initialAfterId?: string | null
}) {
  return render(
    <FeaturedPairPicker
      aftercareHref={AFTERCARE_HREF}
      beforeItems={overrides?.beforeItems ?? [img('b1'), img('b2')]}
      afterItems={overrides?.afterItems ?? [img('a1')]}
      initialBeforeId={overrides?.initialBeforeId ?? null}
      initialAfterId={overrides?.initialAfterId ?? null}
    />,
  )
}

describe('FeaturedPairPicker', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/pro/bookings/booking_1/session/after-photos')
  })

  it('carries the live selection in the Continue link (empty when nothing picked)', () => {
    renderPicker()
    expect(continueHref()).toBe(`${AFTERCARE_HREF}?fb=&fa=`)
  })

  it('updates the Continue link href and the URL as pills toggle', () => {
    renderPicker()

    const [firstBefore] = screen.getAllByRole('button', {
      name: /feature this before photo/i,
    })
    if (!firstBefore) throw new Error('expected a before Feature pill')
    fireEvent.click(firstBefore)
    // The first before tile ('b1') is now featured.
    expect(continueHref()).toBe(`${AFTERCARE_HREF}?fb=b1&fa=`)
    expect(window.location.search).toBe('?fb=b1&fa=')

    fireEvent.click(screen.getByRole('button', { name: /feature this after photo/i }))
    expect(continueHref()).toBe(`${AFTERCARE_HREF}?fb=b1&fa=a1`)
    expect(window.location.search).toBe('?fb=b1&fa=a1')
  })

  it('toggling a featured pill off clears just that field', () => {
    renderPicker({ initialBeforeId: 'b1', initialAfterId: 'a1' })
    expect(continueHref()).toBe(`${AFTERCARE_HREF}?fb=b1&fa=a1`)

    // The featured before tile now exposes a "remove" action.
    fireEvent.click(screen.getByRole('button', { name: /remove this before photo as featured/i }))
    expect(continueHref()).toBe(`${AFTERCARE_HREF}?fb=&fa=a1`)
  })

  it('reflects the initial selection from props', () => {
    renderPicker({ initialBeforeId: 'b2', initialAfterId: 'a1' })
    expect(continueHref()).toBe(`${AFTERCARE_HREF}?fb=b2&fa=a1`)
  })

  it('does not render a Feature pill on videos (only images are featurable)', () => {
    renderPicker({ afterItems: [vid('av')] })
    expect(
      screen.queryByRole('button', { name: /feature this after photo/i }),
    ).toBeNull()
    // The before images still offer featuring.
    expect(
      screen.getAllByRole('button', { name: /feature this before photo/i }).length,
    ).toBeGreaterThan(0)
  })

  it('shows an empty-state note when a strip has no photos', () => {
    renderPicker({ beforeItems: [] })
    expect(screen.getByText(/no before photos yet/i)).toBeTruthy()
  })
})
