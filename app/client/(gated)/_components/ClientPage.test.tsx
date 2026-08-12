// app/client/(gated)/_components/ClientPage.test.tsx
//
// Two jobs:
//   1. Pin ClientPage's own contract (header order, back link, hero opt-in).
//   2. Guard the RULE that made it necessary — every gated client page renders
//      inside the shell, and every page that is not a footer tab gives the
//      client a way back out.
//
// The second half derives its page list from the filesystem (the routing SSOT)
// rather than a hand-kept array, so a new page under app/client/(gated) is
// covered the moment it is added — see the completeness-guard rule in
// docs/instructions. A page that legitimately has no back link (a footer tab)
// must be named in TAB_PAGES, which is itself checked against CLIENT_TABS.
import fs from 'node:fs'
import path from 'node:path'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CLIENT_TABS } from '@/app/config/clientNav'

import ClientPage from './ClientPage'

const GATED_ROOT = path.join(process.cwd(), 'app', 'client', '(gated)')

/**
 * Routes whose page IS a footer tab. A tab is the root of its own stack — the
 * footer is both how you got here and how you leave — so it neither needs a
 * back link nor a stock header: Home opens on a greeting and Me opens on the
 * profile hero, which ARE those screens' headers. Same shape as iOS, where a
 * tab root carries its own chrome and only pushes get a back button.
 */
const TAB_PAGES = new Set(['/client', '/client/me'])

/**
 * Files under app/client/(gated) that are not pages in the sense this guard
 * means. Each entry states why, and the checks below prove the reason is still
 * true — an exemption that quietly stops applying is worse than no exemption.
 */
const NOT_A_PAGE = new Map<string, 'intercepting-modal' | 'redirect-only'>([
  ['/client/me/(..)boards/new', 'intercepting-modal'],
  ['/client/bookings/[id]/consultation', 'redirect-only'],
])

/** A JSX mount, not a type annotation — `Promise<ClientPageUser>` is not one. */
const MOUNTS_SHELL = /<ClientPage[\s>]/

/**
 * Route path for a page file. Group segments `(name)` and parallel slots
 * `@name` are dropped, but interception markers `(..)`/`(.)` are KEPT so an
 * intercepting modal is distinguishable from the page it intercepts.
 */
function routeForPageFile(file: string): string {
  const rel = path.relative(GATED_ROOT, path.dirname(file))
  const segments = rel
    .split(path.sep)
    .filter((s) => {
      if (!s || s.startsWith('@')) return false
      if (s.startsWith('(.')) return true
      return !(s.startsWith('(') && s.endsWith(')'))
    })
  return `/client${segments.length ? `/${segments.join('/')}` : ''}`
}

/** Every .tsx in the page's own directory, excluding tests. */
function sourcesBesideThePage(file: string): string[] {
  const dir = path.dirname(file)
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.tsx') && !n.endsWith('.test.tsx'))
    .map((n) => fs.readFileSync(path.join(dir, n), 'utf8'))
}

function findPageFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findPageFiles(full))
    else if (entry.name === 'page.tsx') out.push(full)
  }
  return out
}

describe('ClientPage', () => {
  it('renders eyebrow, title and lede in that order', () => {
    render(
      <ClientPage eyebrow="Aftercare" title="Every summary in one place" lede="From your visits.">
        <p>body</p>
      </ClientPage>,
    )

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Every summary in one place')
    expect(screen.getByText('Aftercare')).toBeInTheDocument()
    expect(screen.getByText('From your visits.')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('renders a back link that names where it goes', () => {
    render(
      <ClientPage title="Aftercare" back={{ href: '/client', label: 'Home' }}>
        <p>body</p>
      </ClientPage>,
    )

    const link = screen.getByRole('link', { name: /Home/ })
    expect(link).toHaveAttribute('href', '/client')
  })

  it('omits the back link entirely when the page is a footer tab', () => {
    render(
      <ClientPage title="Home">
        <p>body</p>
      </ClientPage>,
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders headerExtra OUTSIDE <header> so a sticky row has room to stick', () => {
    // Proven in a browser: nested inside <header>, a sticky filter row unsticks
    // as soon as the header scrolls past. As a sibling its containing block is
    // <main>, which spans the page. Wrapping it would reintroduce the bug, so
    // this asserts the direct-child relationship, not merely "not in header".
    const { container } = render(
      <ClientPage title="Notifications" headerExtra={<div data-testid="filters" />}>
        <p>body</p>
      </ClientPage>,
    )

    const extra = screen.getByTestId('filters')
    expect(container.querySelector('header')?.contains(extra)).toBe(false)
    expect(extra.parentElement?.tagName.toLowerCase()).toBe('main')
  })

  it('only tints the header when hero is opted into', () => {
    const { container, rerender } = render(
      <ClientPage title="Open today.">
        <p>body</p>
      </ClientPage>,
    )
    expect(container.querySelector('header')?.className).not.toContain('--accent-primary')

    rerender(
      <ClientPage title="Open today." hero>
        <p>body</p>
      </ClientPage>,
    )
    expect(container.querySelector('header')?.className).toContain('--accent-primary')
  })
})

describe('every gated client page uses the shell', () => {
  const pageFiles = findPageFiles(GATED_ROOT)
  const routed = pageFiles.map((f) => [routeForPageFile(f), f] as const)
  const shellPages = routed.filter(
    ([route]) => !TAB_PAGES.has(route) && !NOT_A_PAGE.has(route),
  )

  it('finds the gated pages (guard is not silently empty)', () => {
    expect(pageFiles.length).toBeGreaterThanOrEqual(15)
    expect(shellPages.length).toBeGreaterThanOrEqual(12)
  })

  it('TAB_PAGES only names routes that really are footer tabs', () => {
    const tabHrefs = new Set(CLIENT_TABS.map((t) => t.href))
    for (const route of TAB_PAGES) {
      expect(tabHrefs.has(route), `${route} is in TAB_PAGES but not in CLIENT_TABS`).toBe(true)
    }
  })

  it('every exemption in NOT_A_PAGE is still true', () => {
    const byRoute = new Map(routed)

    for (const [route, reason] of NOT_A_PAGE) {
      const file = byRoute.get(route)
      expect(file, `${route} is exempt but no longer exists — drop the entry`).toBeDefined()
      const source = fs.readFileSync(file as string, 'utf8')

      if (reason === 'intercepting-modal') {
        // Route interception is what makes this a modal over another page
        // rather than a page of its own.
        expect(route, `${route} is not an intercepting route`).toMatch(/\(\.+\)/)
      } else {
        // Redirect-only: it must redirect, and it must render nothing.
        expect(source, `${route} no longer redirects`).toMatch(/\bredirect\(/)
        expect(
          /return\s*\(?\s*</.test(source),
          `${route} renders JSX now — it is a real page, so it needs the shell`,
        ).toBe(false)
      }
    }
  })

  it.each(shellPages)('%s renders ClientPage', (_route, file) => {
    // A page may delegate to a client component; either the page or a sibling
    // in its own directory must mount the shell.
    const sources = [fs.readFileSync(file, 'utf8'), ...sourcesBesideThePage(file)]

    const mounts = sources.some((s) => MOUNTS_SHELL.test(s))
    expect(mounts, `${file} does not render <ClientPage>`).toBe(true)
  })

  it.each(shellPages)('%s gives the client a way back', (_route, file) => {
    const sources = [fs.readFileSync(file, 'utf8'), ...sourcesBesideThePage(file)]

    const hasBack = sources.some((s) => /back=\{\{/.test(s) || /back=\{back/.test(s))
    expect(hasBack, `${file} renders ClientPage without a back link`).toBe(true)
  })
})
