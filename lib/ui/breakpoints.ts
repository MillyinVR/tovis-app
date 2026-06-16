// lib/ui/breakpoints.ts
//
// Canonical responsive breakpoints. CSS-first is the default — use Tailwind's
// `md:` / `lg:` utilities in markup. These constants + the useBreakpoint hook
// exist only for the cases where the component *tree* genuinely differs by
// size and CSS alone can't express it. Values match Tailwind: md=768, lg=1024.
//
//   mobile  : < 768
//   tablet  : 768 – 1023
//   desktop : >= 1024

export const BREAKPOINTS = {
  tablet: 768,
  desktop: 1024,
} as const

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

export const MEDIA = {
  tablet: `(min-width: ${BREAKPOINTS.tablet}px)`,
  desktop: `(min-width: ${BREAKPOINTS.desktop}px)`,
} as const
