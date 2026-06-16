// lib/ui/useBreakpoint.ts
'use client'

import { MEDIA, type Breakpoint } from './breakpoints'
import { useMediaQuery } from './useMediaQuery'

/**
 * Current breakpoint bucket: 'mobile' | 'tablet' | 'desktop'. SSR-safe
 * (resolves to 'mobile' during SSR, then reconciles). Reach for this only
 * when the rendered tree differs by size; otherwise use Tailwind utilities.
 */
export function useBreakpoint(): Breakpoint {
  const isDesktop = useMediaQuery(MEDIA.desktop)
  const isTablet = useMediaQuery(MEDIA.tablet)

  if (isDesktop) return 'desktop'
  if (isTablet) return 'tablet'
  return 'mobile'
}
