import { cn } from '@/lib/utils'

/**
 * Submit button shared across the auth forms. `withArrow` adds the shimmer
 * top-edge and animated trailing arrow used on the hero screens (login,
 * reset); the multi-field signup forms render the plain variant.
 */
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
      className={cn(
        'group relative inline-flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2.5 text-sm font-black transition',
        'border border-accentPrimary/35 bg-accentPrimary/26 text-textPrimary',
        withArrow &&
          'before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.10),transparent)] before:opacity-0 before:transition hover:before:opacity-100',
        'hover:enabled:bg-accentPrimary/30 hover:enabled:border-accentPrimary/45',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
        isDisabled ? 'cursor-not-allowed opacity-65' : 'cursor-pointer',
      )}
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
