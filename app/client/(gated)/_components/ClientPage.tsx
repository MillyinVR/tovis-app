// app/client/(gated)/_components/ClientPage.tsx
//
// The one frame every signed-in client page renders inside.
//
// ## Why this exists
// The client surface grew a page at a time and each one invented its own frame:
// six sibling pages reachable from Home carried six different header treatments
// (bare h1; bare h1 with the action on the title line; a half-size h1; a tinted
// hero band; no title at all; a branded card), four different empty-state
// treatments, three different content measures, and a back affordance on 2 of
// 16 pages. iOS has never had this problem — every one of these screens is a
// NavigationStack push, so it gets a title and a back button for free.
//
// This component is the web equivalent of that push. A page supplies WHAT it is
// (eyebrow / title / lede / action) and its content; the frame — spacing,
// measure, type scale, back link, footer clearance — belongs here and is not a
// per-page decision any more.
//
// ⚠️ `back` is not optional styling. A client page that is not one of the five
// footer tabs (see app/config/clientNav.ts) has NO other way out on web, because
// there is no browser chrome inside the installed PWA. If you add a page without
// `back`, the only exit is a tab — which silently drops the client somewhere
// other than where they came from. Pinned by ClientPage.test.tsx.
import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type ClientPageBack = {
  href: string
  /** Where the client came FROM, e.g. "Home" — never "Back" on its own. */
  label: string
}

/**
 * Content measure. `regular` is the default record/list width; `wide` is for
 * grid surfaces (boards, media) that need the extra column.
 */
export type ClientPageWidth = 'regular' | 'wide'

export type ClientPageProps = {
  /** Mono caps kicker above the title. Omit rather than inventing one. */
  eyebrow?: string
  title: string
  /** One sentence under the title. Keep it to a line or two. */
  lede?: string
  /** Route out of this page. Required unless the page is a footer tab. */
  back?: ClientPageBack
  /**
   * Sits opposite the title. One control, or at most two — it is a header, not
   * a toolbar. Anything more belongs in the content, and FILTERS never belong
   * here at all (see `headerExtra`).
   */
  action?: ReactNode
  width?: ClientPageWidth
  /**
   * Accent wash behind the header block. Reserved for the surfaces whose whole
   * point is urgency (last-minute openings); it is not a decoration to sprinkle.
   *
   * The wash is painted ON the header, so it always finishes exactly where the
   * header does. /client/openings used to paint a fixed 220px-tall gradient on
   * the page instead, which cut across whatever card happened to sit at 220px.
   */
  hero?: boolean
  /**
   * Rendered directly under the header block. This is where FILTERS go —
   * /client/notifications used to mix "Mark all read" and "Show more" into its
   * filter-chip row, so a client read six chips where four were filters.
   *
   * ⚠️ It is a SIBLING of <header>, not a child, and that is load-bearing: a
   * `position: sticky` child can only stick within its containing block, so a
   * sticky filter row nested inside <header> unsticks the moment the header
   * scrolls past — which is to say, immediately. As a sibling its containing
   * block is <main>, so it stays pinned for the whole page.
   */
  headerExtra?: ReactNode
  children: ReactNode
}

const WIDTHS: Record<ClientPageWidth, string> = {
  regular: 'max-w-2xl',
  wide: 'max-w-5xl',
}

/**
 * The hero wash is full-bleed by way of `-mx-4`, which only cancels the gated
 * layout's own `px-4`. That reaches the viewport edge for exactly as long as
 * the content column still fills the layout container — past that point the
 * column is centred with slack on both sides and the "full-bleed" wash becomes
 * a hard-edged rectangle floating in the middle of the page. At 1280 it stopped
 * 288px short of each edge, which reads as a rendering fault rather than a
 * treatment (worst in light mode, where the tint is darker than the page).
 *
 * So past the crossover the wash stops pretending to be full-bleed and becomes
 * a rounded panel aligned to the column instead. The breakpoints are derived
 * from the layout, not picked:
 *   regular — column is max-w-2xl (672) + the layout's two px-4 gutters (32).
 *   wide    — the column matches the layout container, so the container's own
 *             max-w-5xl (1024) is where slack first appears.
 */
const HERO_CONTAINED: Record<ClientPageWidth, string> = {
  regular: 'min-[704px]:mx-0 min-[704px]:mt-0 min-[704px]:rounded-card min-[704px]:px-5',
  wide: 'min-[1024px]:mx-0 min-[1024px]:mt-0 min-[1024px]:rounded-card min-[1024px]:px-5',
}

export default function ClientPage({
  eyebrow,
  title,
  lede,
  back,
  action,
  width = 'regular',
  hero = false,
  headerExtra,
  children,
}: ClientPageProps) {
  return (
    // pb-28 clears the fixed client footer (min-height 80px + safe area).
    <main className={cn('mx-auto w-full pb-28', WIDTHS[width])}>
      <header
        className={cn(
          'flex flex-col gap-3',
          // headerExtra supplies its own bottom gap, so the header gives it less.
          headerExtra ? 'mb-3' : 'mb-6',
          hero
            // -mt-4 cancels the gated layout's pt-4 so the wash reaches the top
            // edge of the viewport instead of floating below a bare strip.
            ? cn(
                '-mx-4 -mt-4 bg-[linear-gradient(180deg,rgb(var(--accent-primary)/0.12),transparent)] px-4 pb-8 pt-6',
                HERO_CONTAINED[width],
              )
            : 'pt-1',
        )}
      >
        {back ? (
          <Link
            href={back.href}
            className="brand-focus -ml-1 inline-flex w-fit items-center gap-1.5 rounded-full px-1 py-0.5 text-[13px] font-bold text-textSecondary transition hover:text-textPrimary"
          >
            <span aria-hidden="true">←</span>
            {back.label}
          </Link>
        ) : null}

        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            {eyebrow ? (
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-textMuted">
                {eyebrow}
              </p>
            ) : null}

            <h1 className="font-display text-[26px] font-black leading-[1.1] tracking-[-0.02em] text-textPrimary">
              {title}
            </h1>
          </div>

          {action ? <div className="shrink-0 pt-0.5">{action}</div> : null}
        </div>

        {lede ? (
          <p className="max-w-prose text-[14px] leading-relaxed text-textSecondary">
            {lede}
          </p>
        ) : null}

      </header>

      {/*
        Rendered BARE — a direct child of <main>, with no wrapper of its own.
        A wrapper would become the sticky containing block and be exactly as
        tall as the row inside it, leaving nothing to stick within. <main>
        spans the page, so a sticky row pins for the whole scroll. The page
        owns this block's bottom spacing for the same reason.
      */}
      {headerExtra}

      {children}
    </main>
  )
}
