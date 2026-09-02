// app/(main)/looks/_components/RightActionRail.test.tsx
//
// The rail draws its marks ON A PHOTOGRAPH, and that is the whole reason its ink
// cannot follow the theme. These pin the ink and the shadow, because the defect
// they fix is invisible in a diff and invisible in every existing test: the
// component rendered the same markup either way, and only the VALUE the token
// resolved to changed — cream in the feed (which pins `data-mode="dark"`),
// near-black on the look detail (which pins nothing).

import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('./SaveToBoardModal', () => ({
  default: () => <div data-testid="save-modal" />,
}))

import RightActionRail from './RightActionRail'

function renderRail() {
  return render(
    <RightActionRail
      lookPostId="look_1"
      pro={{ id: 'pro_1', businessName: 'TOVIS Studio', avatarUrl: null }}
      viewerLiked={false}
      likeCount={4}
      commentCount={2}
      onOpenAvailability={() => {}}
      onToggleLike={() => {}}
      onOpenComments={() => {}}
      onShare={() => {}}
    />,
  )
}

/** The icon's own inline colour, walked up from its accessible button. */
function iconColorFor(name: string): string {
  const button = screen.getByRole('button', { name })
  const svg = button.querySelector('svg')
  if (!svg) throw new Error(`no icon inside "${name}"`)
  return svg.getAttribute('style') ?? ''
}

describe('RightActionRail — ink over a photograph', () => {
  it('🔴 draws its marks in the MODE-CONSTANT ink, never --text-primary', () => {
    renderRail()

    // `--text-primary` flips with [data-mode]. The looks FEED hides that by
    // pinning `data-mode="dark"` for its subtree; the look DETAIL page pins
    // nothing, so the same rail over the same photo went near-black in light
    // mode. Measured on prod at 393px before this changed.
    for (const name of ['Like', 'Open comments', 'Share']) {
      expect(iconColorFor(name)).toContain('rgb(var(--on-photo))')
      expect(iconColorFor(name)).not.toContain('--text-primary')
    }
  })

  it('gives the icons a shadow the LABELS already had', () => {
    const { container } = renderRail()

    // `text-shadow` does not touch an SVG, so the numbers under the icons were
    // shadowed and the icons themselves were not — on a pale photograph that is
    // exactly where a mark disappears.
    const shadowed = Array.from(container.querySelectorAll('[style*="drop-shadow"]'))
    expect(shadowed.length).toBeGreaterThan(0)
    for (const el of shadowed) {
      expect(el.getAttribute('style')).toContain('--on-photo-shadow')
    }
    // Every icon sits inside one of those wrappers.
    for (const name of ['Like', 'Open comments', 'Share']) {
      const svg = screen.getByRole('button', { name }).querySelector('svg')
      expect(svg?.closest('[style*="drop-shadow"]')).not.toBeNull()
    }
  })

  it('keeps the liked/saved accents, which are meaning and not chrome', () => {
    render(
      <RightActionRail
        lookPostId="look_1"
        pro={{ id: 'pro_1', businessName: 'TOVIS Studio', avatarUrl: null }}
        viewerLiked
        likeCount={5}
        commentCount={0}
        onOpenAvailability={() => {}}
        onToggleLike={() => {}}
        onOpenComments={() => {}}
        onShare={() => {}}
      />,
    )
    expect(iconColorFor('Unlike')).toContain('--color-ember')
  })
})
