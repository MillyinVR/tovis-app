// app/_components/boundaries/errorHomeRoutes.test.ts
//
// Every escape hatch on an error boundary must land on a route that actually
// exists. app/professionals/{error,not-found}.tsx used to offer "Browse pros"
// pointing at /professionals — a directory with only [id]/ and dashboard/ under
// it and no page.tsx — so the only way out of that 404 was another 404.
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ADMIN_HOME,
  CLIENT_HOME,
  GUEST_HOME,
  PRO_HOME,
  type ErrorHome,
} from './errorHome'

const APP_DIR = path.resolve(__dirname, '../..')

function isRouteGroup(name: string): boolean {
  return name.startsWith('(') && name.endsWith(')')
}

/**
 * Does `/a/b` resolve to a page? Route groups — `(main)`, `(gated)` — are
 * transparent in the URL, so they may appear at any depth and are stepped
 * through without consuming a segment.
 */
function routeHasPage(dir: string, segments: string[]): boolean {
  if (segments.length === 0 && existsSync(path.join(dir, 'page.tsx'))) {
    return true
  }

  const [head, ...rest] = segments
  if (head !== undefined) {
    const next = path.join(dir, head)
    if (
      statSync(next, { throwIfNoEntry: false })?.isDirectory() &&
      routeHasPage(next, rest)
    ) {
      return true
    }
  }

  // A group can sit at any depth, including below the last real segment
  // (/client is app/client/(gated)/page.tsx), so this runs even once the
  // segments are exhausted.
  return readdirSync(dir, { withFileTypes: true }).some(
    (entry) =>
      entry.isDirectory() &&
      isRouteGroup(entry.name) &&
      routeHasPage(path.join(dir, entry.name), segments),
  )
}

function resolves(href: string): boolean {
  return routeHasPage(APP_DIR, href.split('/').filter(Boolean))
}

describe('error-boundary escape hatches point at real routes', () => {
  it.each<[string, ErrorHome]>([
    ['guest', GUEST_HOME],
    ['client', CLIENT_HOME],
    ['pro', PRO_HOME],
    ['admin', ADMIN_HOME],
  ])('%s home resolves to a page', (_role, home) => {
    expect(resolves(home.href)).toBe(true)
  })

  it('the professionals boundaries’ "Browse pros" target resolves to a page', () => {
    expect(resolves('/search')).toBe(true)
  })

  it('sanity: the old /professionals target really has no page', () => {
    expect(resolves('/professionals')).toBe(false)
  })
})
