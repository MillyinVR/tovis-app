'use client'

// Shared empty-list UI for the app's list surfaces (messages, bookings,
// clients, search results, looks feed, …). Mirrors ErrorState/NotFoundState:
// white-label safe — brand tokens + tone utilities only, no hardcoded colors
// or brand strings. Inline card form (not full-page) so it sits inside a list
// container where the rows would otherwise be. A CTA may be a link (href) or an
// action (onClick); render a button only when onClick is given.
import Link from 'next/link'
import type { ReactNode } from 'react'

type EmptyStateAction = {
  label: string
  /** Render the CTA as a link to this href. */
  href?: string
  /** Render the CTA as a button calling this handler (used when no href). */
  onClick?: () => void
}

type EmptyStateProps = {
  /** Optional icon/illustration shown above the heading. */
  icon?: ReactNode
  /** Optional small uppercase eyebrow label above the heading. */
  eyebrow?: string
  /** Headline. */
  title: string
  /** Body copy. */
  description?: string
  /** Optional CTA — a link (href) or an action (onClick). */
  action?: EmptyStateAction
  /** Extra classes merged onto the wrapper (e.g. spacing tweaks). */
  className?: string
}

function EmptyStateCta({ action }: { action: EmptyStateAction }) {
  const className =
    'brand-focus mt-1 inline-flex rounded-full border border-accentPrimary/30 bg-accentPrimary/10 px-4 py-2 text-sm font-black text-accentPrimary transition hover:bg-accentPrimary/16'

  if (action.href) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    )
  }

  return (
    <button type="button" onClick={action.onClick} className={className}>
      {action.label}
    </button>
  )
}

export default function EmptyState({
  icon,
  eyebrow,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-card border border-surfaceGlass/14 bg-bgSecondary/60 px-6 py-10 text-center ${
        className ?? ''
      }`}
    >
      {icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-surfaceGlass/14 bg-bgPrimary/40 text-textSecondary">
          {icon}
        </div>
      ) : null}

      {eyebrow ? (
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-textMuted">
          {eyebrow}
        </div>
      ) : null}

      <h2 className="text-base font-black text-textPrimary">{title}</h2>

      {description ? (
        <p className="max-w-sm text-sm text-textSecondary">{description}</p>
      ) : null}

      {action ? <EmptyStateCta action={action} /> : null}
    </div>
  )
}
