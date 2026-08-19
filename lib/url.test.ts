import { describe, expect, it } from 'vitest'

import { isSameUrlIgnoringQuery, withCacheBuster } from './url'

// 🔴 These two functions are a PAIR, and that is the whole point of testing them
// together. `withCacheBuster` is what puts a `?v=` on a viral request's cover
// when a reviewer promotes an attachment; `isSameUrlIgnoringQuery` is what has to
// recognise that cover as the same object as the attachment it came from. If
// only the first exists, removing a promoted attachment deletes the bytes and
// leaves the cover pointing at a 404 on every client surface.
describe('isSameUrlIgnoringQuery', () => {
  const base =
    'https://project.supabase.co/storage/v1/object/public/media-public/viral-requests/req_1/uploads/inspo.jpg'

  it('matches a URL against its own cache-busted form', () => {
    // Composed rather than hand-written, so this cannot drift from what the
    // promote path actually stores.
    expect(isSameUrlIgnoringQuery(withCacheBuster(base, 1755500000000), base)).toBe(
      true,
    )
  })

  it('matches regardless of which side carries the query', () => {
    const busted = withCacheBuster(base, 1)
    expect(isSameUrlIgnoringQuery(base, busted)).toBe(true)
    expect(isSameUrlIgnoringQuery(busted, base)).toBe(true)
    expect(isSameUrlIgnoringQuery(busted, withCacheBuster(base, 2))).toBe(true)
  })

  it('does not match different objects', () => {
    const other = base.replace('inspo.jpg', 'other.jpg')
    expect(isSameUrlIgnoringQuery(base, other)).toBe(false)
    expect(isSameUrlIgnoringQuery(withCacheBuster(base, 1), other)).toBe(false)
  })

  // Nothing is not everything: two absent covers must not read as "the same
  // object", or removing any attachment would clear a cover that isn't set.
  it.each([
    ['both null', null, null],
    ['left null', null, base],
    ['right null', base, null],
    ['both undefined', undefined, undefined],
    ['both blank', '   ', '   '],
    ['query only', '?v=1', '?v=2'],
  ])('is false when %s', (_label, a, b) => {
    expect(isSameUrlIgnoringQuery(a, b)).toBe(false)
  })

  it('ignores surrounding whitespace', () => {
    expect(isSameUrlIgnoringQuery(`  ${base}  `, base)).toBe(true)
  })
})
