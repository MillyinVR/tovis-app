/**
 * Single source of truth for z-index stacking order across the app.
 *
 * Every element that participates in the **root** stacking context — the global
 * footer nav, modals, drawers, full-screen overlays/backdrops, and toasts —
 * must draw its z-index from here so the layering is consistent and the
 * footer-vs-modal ordering can never regress.
 *
 * Tiers (low → high):
 *   base       normal content plane
 *   popover    anchored popovers/menus/autocomplete in the content flow
 *   sticky     sticky in-page bars / fixed action bars (below the footer)
 *   header     fixed page-level top bars (below the footer)
 *   footer     the global fixed bottom navigation (app/layout.tsx)
 *   overlay    full-screen modal/drawer backdrops — ABOVE the footer
 *   modal      modal & drawer panels — ABOVE the footer
 *   nestedModal a modal opened from within another modal/drawer
 *   toast      transient top-most notifications
 *
 * Local stacking *within* an element that already establishes its own stacking
 * context (e.g. a `relative`/`fixed` modal whose children layer among
 * themselves) intentionally keeps plain Tailwind utilities (`z-10`, `z-20`, …)
 * and is NOT represented here — those values never compete with the footer.
 *
 * Use `Z.*` for inline `style={{ zIndex }}` and `zClass.*` for Tailwind
 * `className`. The two maps MUST stay in lock-step; keep their numbers equal.
 */
export const Z = {
  base: 0,
  popover: 800,
  sticky: 900,
  header: 950,
  footer: 999999,
  overlay: 1_000_000,
  modal: 1_000_100,
  nestedModal: 1_000_200,
  toast: 1_000_300,
} as const

export type ZTier = keyof typeof Z

/**
 * Literal Tailwind arbitrary-value classes mirroring {@link Z}. They must be
 * literals so Tailwind's JIT can generate the utilities from this file.
 */
export const zClass = {
  popover: 'z-[800]',
  sticky: 'z-[900]',
  header: 'z-[950]',
  footer: 'z-[999999]',
  overlay: 'z-[1000000]',
  modal: 'z-[1000100]',
  nestedModal: 'z-[1000200]',
  toast: 'z-[1000300]',
} as const satisfies Record<Exclude<ZTier, 'base'>, `z-[${number}]`>
