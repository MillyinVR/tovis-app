// test/renderWithBrand.tsx
//
// Components that read the tenant-resolved brand do it through useBrand(),
// which throws outside a BrandProvider — deliberately, because a brand read
// with no provider above it has no tenant context and would silently fall
// back to the deployment's NEXT_PUBLIC_BRAND. That is the bug
// check-brand-resolution.mjs exists to prevent, so the hook must not paper
// over it.
//
// The consequence is that a jsdom test of such a component has to model the
// real tree, where the root layout puts a provider above everything. This is
// that provider, and nothing else: no brand prop, so BrandProvider takes its
// own documented detached-tree fallback, which is what a test wants.

import type { ReactElement } from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'

import { BrandProvider } from '@/lib/brand/BrandProvider'

/**
 * jsdom has no matchMedia, and BrandProvider subscribes to
 * prefers-color-scheme. Stubbed here rather than in vitest.setup.ts so the
 * 899 suites that never render a provider keep the environment they have,
 * and rather than in lib/brand/theme.ts because every real browser has it —
 * this is jsdom's gap, not a hole in shipped code.
 */
function stubMatchMedia(): void {
  // `typeof`, not truthiness: lib.dom types matchMedia as always present, so
  // `if (window.matchMedia)` is a compile error (TS2774) even though jsdom
  // genuinely does not define it.
  if (typeof window === 'undefined') return
  if (typeof window.matchMedia === 'function') return

  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

export function renderWithBrand(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  stubMatchMedia()

  return render(ui, { ...options, wrapper: BrandProvider })
}
