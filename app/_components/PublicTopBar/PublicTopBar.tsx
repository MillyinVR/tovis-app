// app/_components/PublicTopBar/PublicTopBar.tsx
// Shared top bar for all public/guest-facing pages.
// Mobile-first: on small screens shows only brand wordmark + Log in.
// The bottom GuestSessionFooter handles all nav links on mobile.
// On sm+ breakpoints the text nav links appear alongside the wordmark.
import Link from 'next/link'
import BrandWordmark from '@/lib/brand/BrandWordmark'

export type PublicTopBarLink = {
  href: string
  label: string
}

const defaultNavLinks: readonly PublicTopBarLink[] = [
  { href: '/about', label: 'About' },
  { href: '/support', label: 'Support' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
] as const

type Props = {
  /** Optional Tailwind classes applied to the <header> wrapper */
  className?: string
  /**
   * Replaces the default About/Support/Privacy/Terms set. The homepage passes
   * its own in-page section anchors instead — those links are what a landing
   * page's bar is for, and the policy pages it displaces are still one tap
   * away in the footer and the mobile GuestSessionFooter. Log in is never
   * part of this list, so no caller can drop it.
   */
  links?: readonly PublicTopBarLink[]
}

export default function PublicTopBar({ className, links }: Props) {
  const navLinks = links ?? defaultNavLinks

  return (
    <header
      className={[
        'flex items-center justify-between px-6 py-5 sm:px-10 lg:px-16',
        className ?? '',
      ].join(' ')}
    >
      {/* Wordmark — always visible, links home */}
      <Link
        href="/"
        aria-label="tovis home"
        className="text-textPrimary/80 transition hover:text-textPrimary"
      >
        <BrandWordmark size={20} />
      </Link>

      <nav className="flex items-center" aria-label="Site navigation">
        {/* Text links — hidden on mobile (bottom nav handles them) */}
        <div className="hidden items-center gap-0.5 sm:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-inner px-3 py-1.5 text-[11px] font-medium text-textSecondary/55 transition hover:text-textPrimary"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Log in — always visible. Min 44px touch target height via py-2.5 */}
        <Link
          href="/login"
          className="ml-1 rounded-inner border border-textPrimary/20 px-4 py-2.5 text-[11px] font-bold text-textPrimary/80 transition hover:border-textPrimary/35 hover:text-textPrimary sm:ml-3"
        >
          Log in
        </Link>
      </nav>
    </header>
  )
}
