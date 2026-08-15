import { cn } from '@/lib/utils'

/**
 * Submit button shared across the auth forms. `withArrow` adds the shimmer
 * top-edge and animated trailing arrow used on the hero screens (login, reset,
 * verify); the multi-field signup forms render the plain variant.
 *
 * Not a kit primitive: the kit's `Button variant="primary"` is the app's gradient
 * CTA, and this is the auth screens' own tinted hero button. It stays the area
 * canonical — but there is exactly ONE copy of its class string now, here.
 */

export type PrimaryButtonStyleOptions = {
  /** Dims and blocks the hover states. Links are never disabled. */
  disabled?: boolean
  /** Adds the shimmer sweep (the arrow itself is rendered by the component). */
  withArrow?: boolean
  className?: string
}

/**
 * Canonical class string — for the `<Link>` CTAs that can't be a `<button>`,
 * mirroring how the UI kit exposes `buttonClassName`/`badgeClassName`.
 *
 * The hover rules are applied conditionally rather than with `hover:enabled:`,
 * because `:enabled` does not match an `<a>` — an anchor wearing the old string
 * silently lost every hover state it declared.
 */
export function primaryButtonClassName({
  disabled = false,
  withArrow = false,
  className,
}: PrimaryButtonStyleOptions = {}): string {
  return cn(
    'group relative inline-flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2.5 text-sm font-black transition',
    'border border-accentPrimary/35 bg-accentPrimary/26 text-textPrimary',
    'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
    // NOTE: the two shimmer gradients here keep their raw `rgba(255,255,255,…)`.
    // They are pre-existing phase-7 raw-colour entries, and swapping them for
    // `rgb(var(--surface-glass)/…)` would flip the sweep from light to dark in
    // light mode — a restyle, not a consolidation. Phase 7 owns that call, with
    // a screenshot in both modes.
    withArrow &&
      'before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.10),transparent)] before:opacity-0 before:transition',
    disabled
      ? 'cursor-not-allowed opacity-65'
      : cn(
          'cursor-pointer hover:bg-accentPrimary/30 hover:border-accentPrimary/45',
          withArrow && 'hover:before:opacity-100',
        ),
    className,
  )
}

export default function PrimaryButton({
  children,
  loading,
  disabled,
  withArrow,
}: {
  children: React.ReactNode
  loading?: boolean
  disabled?: boolean
  withArrow?: boolean
}) {
  const isDisabled = Boolean(disabled || loading)

  return (
    <button
      type="submit"
      disabled={isDisabled}
      className={primaryButtonClassName({ disabled: isDisabled, withArrow })}
    >
      {withArrow ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)]"
        />
      ) : null}
      <span className="relative inline-flex items-center gap-2">
        <span>{children}</span>
        {withArrow ? (
          <span
            aria-hidden="true"
            className="inline-block transition-transform duration-200 group-hover:translate-x-0.5"
          >
            →
          </span>
        ) : null}
      </span>
    </button>
  )
}
