// app/_components/ProfileIdentityLink.tsx
//
// The shared body behind ProProfileLink (a pro's identity, for clients — #829)
// and ClientProfileLink (a client's identity, for pros). Both are the same
// widget with a different way of working out the destination, so the rendering —
// inert span vs Link, the tooltip, the a11y label for an avatar-only body, the
// focus ring — lives here once.
//
// Takes an already-resolved href. Null is a REAL state, not a fallback: it means
// "this viewer has nowhere to go for this person", and it must render plain text
// with NO href in the DOM rather than a link that 404s or refuses on arrival.
//
// Nested-link note: an <a> inside an <a> is invalid HTML and the inner one
// silently loses its click, so a row that is itself one big link must use
// <CardLinkOverlay> rather than nesting this inside it.
import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type ProfileIdentityLinkProps = {
  /** Where this identity leads. Null/blank → inert (no href in the DOM). */
  href?: string | null
  /** Display name. Body when no children are given, and always the a11y label. */
  label: string
  /** Fallback when `label` is blank — e.g. 'Professional' / 'Client'. */
  fallbackLabel: string
  /** Custom body — e.g. an <Avatar/>. Falls back to `label` as text. */
  children?: ReactNode
  className?: string
  /** Class applied only in the inert (no-href) case. Defaults to `className`. */
  inertClassName?: string
  /** Overrides the default "View <name>'s profile" tooltip. */
  title?: string
  /** Hover underline. Pass false for avatar/graphic bodies. */
  underline?: boolean
  /**
   * Accessible name for the link. Defaults to the tooltip text when `children`
   * carry no text of their own (an avatar-only link), so screen readers don't
   * announce a bare "link".
   */
  ariaLabel?: string
}

export default function ProfileIdentityLink({
  href,
  label,
  fallbackLabel,
  children,
  className,
  inertClassName,
  title,
  underline = true,
  ariaLabel,
}: ProfileIdentityLinkProps) {
  const text = label.trim() ? label.trim() : fallbackLabel
  const body = children ?? text
  const tooltip = title ?? `View ${text}'s profile`

  const target = typeof href === 'string' && href.trim() ? href.trim() : null

  if (!target) {
    return (
      <span className={inertClassName ?? className} title={title}>
        {body}
      </span>
    )
  }

  return (
    <Link
      href={target}
      title={tooltip}
      aria-label={ariaLabel ?? (children ? tooltip : undefined)}
      className={cn(
        underline && 'underline-offset-4 hover:underline',
        'rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/50',
        className,
      )}
    >
      {body}
    </Link>
  )
}
