// Probe for the brand-resolution guard.
//
// The register's standing lesson about detectors: give it a case that MUST be
// flagged and a case that MUST NOT, and look at what it stays silent about as
// hard as at what it reports.
//
// The silence matters more than usual here. Two guards in this repo have
// already been fooled by prose — a docstring's example class emitted a real
// CSS rule into the shipped stylesheet, and check-no-bare-tint-token flagged
// the comment explaining its own fix. This guard's most obvious false positive
// is lib/booking/writeBoundary.ts, whose comment says "Do NOT swap this for
// `getBrandConfig()`": the file doing exactly the right thing, reported for
// saying so.
import { describe, expect, it } from 'vitest'

import { isGuardedPath, scanSource, stripComments } from './check-brand-resolution.mjs'

type Violation = { file: string; line: number }

const lines = (src: string): number[] =>
  (scanSource('probe.ts', src) as Violation[]).map((v) => v.line)

describe('must flag — a brand read that walks the env chain', () => {
  it('flags a bare call', () => {
    expect(lines('const brand = getBrandConfig()')).toEqual([1])
  })

  it('flags a call that passes a host, which resolves no better', () => {
    expect(lines('const brand = getBrandConfig({ host })')).toEqual([1])
  })

  it('flags a call chained straight into a property', () => {
    expect(lines('copy={getBrandConfig().clientConsultResults}')).toEqual([1])
  })

  it('flags whitespace between the name and the paren', () => {
    expect(lines('getBrandConfig ()')).toEqual([1])
  })

  it('reports every call site, not just the first', () => {
    expect(lines('getBrandConfig()\nconst x = 1\ngetBrandConfig({ host })')).toEqual(
      [1, 3],
    )
  })
})

describe('must NOT flag — prose, and names that merely contain it', () => {
  it('ignores a line comment warning against the call', () => {
    expect(lines('// Do NOT swap this for `getBrandConfig()` — it walks a host')).toEqual(
      [],
    )
  })

  it('ignores a block comment, including a JSDoc one', () => {
    expect(
      lines('/**\n * Never getBrandConfig() here.\n */\nconst ok = 1'),
    ).toEqual([])
  })

  it('ignores a trailing comment but still sees the code before it', () => {
    expect(lines('const a = 1 // getBrandConfig() is wrong here')).toEqual([])
    expect(lines('getBrandConfig() // this one is real')).toEqual([1])
  })

  it('does not treat a url inside a string as opening a comment', () => {
    expect(
      lines("const doc = 'https://x/y' \nconst brand = getBrandConfig()"),
    ).toEqual([2])
  })

  it('ignores the tenant-aware function whose name contains no such call', () => {
    expect(
      lines('const brand = getBrandForTenantContext(await ctx())'),
    ).toEqual([])
  })

  it('ignores an identifier that merely ENDS with the guarded name', () => {
    // The word boundary is doing the work here, so the probe has to end in a
    // lowercase `g` — `unsafeGetBrandConfig` would pass on the capital alone
    // and prove nothing. The register has been bitten by a `\b` that did not
    // hold where it was assumed to (`_` is a word character, so `\brgba?\(`
    // never matched inside a Tailwind bracket and a whole family went unseen).
    expect(lines('const x = mygetBrandConfig()')).toEqual([])
  })
})

describe('stripComments preserves line numbers', () => {
  it('keeps a violation on its own line after a multi-line comment', () => {
    expect(lines('/* one\n   two\n   three */\ngetBrandConfig()')).toEqual([4])
  })

  it('blanks comment text without collapsing the file', () => {
    expect(stripComments('a // b\nc').split('\n')).toHaveLength(2)
  })
})

describe('scope', () => {
  it('has no opinion about lib/brand, which owns the resolver', () => {
    expect(isGuardedPath('lib/brand/index.ts')).toBe(false)
    expect(isGuardedPath('lib/brand/BrandProvider.tsx')).toBe(false)
  })

  it('has no opinion about tests', () => {
    expect(isGuardedPath('app/pro/calendar/x.test.ts')).toBe(false)
    expect(isGuardedPath('app/x/__tests__/y.ts')).toBe(false)
  })

  it('does guard everything else, including lib', () => {
    expect(isGuardedPath('app/page.tsx')).toBe(true)
    expect(isGuardedPath('lib/booking/writeBoundary.ts')).toBe(true)
    // Not a lib/brand path — the prefix must be the DIRECTORY, not a stem.
    expect(isGuardedPath('lib/branding/x.ts')).toBe(true)
  })
})
