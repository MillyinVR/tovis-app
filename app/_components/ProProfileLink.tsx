// app/_components/ProProfileLink.tsx
//
// Single source of truth for making a pro's IDENTITY — their name, their avatar,
// or both — tap through to their public profile. Every client-facing surface that
// renders a pro routes through this, so "is the pro clickable here?" is one
// decision in one place instead of an ad-hoc <Link> (or a forgotten one) per card.
//
// Mirrors ClientNameLink (the pro-side equivalent, which links a client's name to
// their chart): a missing id renders inert text with NO href in the DOM, never a
// link to `/professionals/`.
//
// Nested-link note: several client cards are one big <Link> to a booking/thread.
// An <a> inside an <a> is invalid HTML and the inner one silently loses its click,
// so those cards use <CardLinkOverlay> + `pointer-events-auto` on this link rather
// than nesting. See app/_components/ui/CardLinkOverlay.tsx.
import Link from 'next/link'
import type { ReactNode } from 'react'

import { proPublicProfilePath } from '@/lib/routes'
import { cn } from '@/lib/utils'

export type ProProfileLinkProps = {
  /** The pro's id. Blank/missing → inert (no href in the DOM). */
  proId?: string | null
  /** The pro's display name. Used as the body when no children are given, and always for the a11y label. */
  label: string
  /** Custom body — e.g. an <Avatar/>. Falls back to `label` as text. */
  children?: ReactNode
  className?: string
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

/** Links a pro's name/avatar to their public profile; inert when the id is missing. */
export default function ProProfileLink({
  proId,
  label,
  children,
  className,
  title,
  underline = true,
  ariaLabel,
}: ProProfileLinkProps) {
  const text = label.trim() ? label.trim() : 'Professional'
  const href = proPublicProfilePath(proId)
  const body = children ?? text
  const tooltip = title ?? `View ${text}'s profile`

  if (!href) {
    return (
      <span className={className} title={title}>
        {body}
      </span>
    )
  }

  return (
    <Link
      href={href}
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
