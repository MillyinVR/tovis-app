// tests/config/nextRedirects.test.ts
//
// Pins the `/pro/media/:id` → `/media/:id` canonical redirect added when the
// less-guarded `app/pro/media/[id]/page.tsx` fork was removed.
//
// The thing under test is the `(?!new$)` negative lookahead in the source
// pattern. Without it, `:id` also matches `/pro/media/new` — the live uploader
// page — and Next would 308 it to `/media/new`, silently breaking the pro's
// only upload entry point. Nothing else in the suite covers next.config, and a
// redirect that shadows a real page fails in a way typecheck and lint cannot
// see.
import { describe, expect, it } from 'vitest'

import nextConfig from '@/next.config'

type RedirectEntry = {
  source: string
  destination: string
  permanent: boolean
}

async function getRedirects(): Promise<RedirectEntry[]> {
  const redirects = nextConfig.redirects
  if (typeof redirects !== 'function') {
    throw new Error('next.config no longer defines redirects()')
  }
  return (await redirects()) as RedirectEntry[]
}

/**
 * Next compiles a `:param(<regex>)` segment by using `<regex>` verbatim as that
 * segment's matcher. Extract it and exercise it directly — this is the exact
 * expression that decides whether a path segment is redirected, so testing it
 * tests the real discriminator without pulling in path-to-regexp (which is not
 * a direct dependency of this repo).
 */
function segmentMatcher(source: string): RegExp {
  const inline = source.match(/:id\((.+)\)$/)
  if (!inline) {
    throw new Error(
      `Expected the /pro/media source to constrain :id with an inline regex, got: ${source}`,
    )
  }
  return new RegExp(`^${inline[1]}$`)
}

describe('next.config redirects — /pro/media/[id] canonicalization', () => {
  it('redirects /pro/media/:id to the guarded /media/:id, permanently', async () => {
    const entry = (await getRedirects()).find((r) =>
      r.source.startsWith('/pro/media/'),
    )

    expect(entry).toBeDefined()
    expect(entry?.destination).toBe('/media/:id')
    // 308, not 307: this is a canonicalization, not a temporary move.
    expect(entry?.permanent).toBe(true)
  })

  it('does NOT capture /pro/media/new — the live uploader page', async () => {
    const entry = (await getRedirects()).find((r) =>
      r.source.startsWith('/pro/media/'),
    )
    const matcher = segmentMatcher(entry!.source)

    // The whole point of the lookahead.
    expect(matcher.test('new')).toBe(false)
  })

  it('still captures real media ids, including ids that merely start with "new"', async () => {
    const entry = (await getRedirects()).find((r) =>
      r.source.startsWith('/pro/media/'),
    )
    const matcher = segmentMatcher(entry!.source)

    // A cuid, the actual id shape this route receives.
    expect(matcher.test('cmrbry49i005jpo0dgjdcwpeh')).toBe(true)
    // Only the exact segment "new" is excluded — the lookahead is anchored, so
    // an id that happens to begin with those letters must still redirect.
    expect(matcher.test('newsflash')).toBe(true)
  })

  it('does not match across a path separator', async () => {
    const entry = (await getRedirects()).find((r) =>
      r.source.startsWith('/pro/media/'),
    )
    const matcher = segmentMatcher(entry!.source)

    expect(matcher.test('abc/def')).toBe(false)
  })
})
