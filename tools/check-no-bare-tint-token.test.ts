// Probe for the tint-token opacity guard.
//
// The register's standing lesson about detectors: give it a case that MUST be
// flagged and a case that MUST NOT, and look at what it stays silent about as
// hard as at what it reports. This guard shipped for months matching any class
// name ending in `-<token>`, which only became visible when a token was named
// `scrim` and it started flagging three photo gradients (`.tovis-overlay-scrim`
// and friends) that cannot paint the token at any opacity.
//
// So the negative cases here are the point: skipping a repo-defined CSS class
// must NOT also skip a real bare utility that happens to look like one.
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  readDefinedCssClasses,
  readTintTokens,
  scanSource,
} from './check-no-bare-tint-token.mjs'

type Violation = { file: string; line: number; snippet: string; hint: string }

const TOKENS = [
  { name: 'surfaceGlass', cssVar: '--surface-glass' },
  { name: 'scrim', cssVar: '--scrim' },
]

// The three real classes that exposed the bug, plus a control that is NOT
// defined anywhere so the skip cannot be blanket.
const DEFINED = new Set([
  'tovis-overlay-scrim',
  'brand-pp-tile-scrim',
  'brand-profile-cover-scrim',
])

const scan = (src: string): Violation[] =>
  scanSource('probe.tsx', src, TOKENS, DEFINED) as Violation[]

// Asserting on a MAPPED array rather than on `found[0]` keeps the expectation
// total: an empty result fails loudly instead of tripping over `undefined`.
const lines = (src: string): number[] => scan(src).map((v) => v.line)

describe('must flag — a tint token painted solid', () => {
  it('flags a bare utility for every tint token', () => {
    expect(lines('<div className="bg-surfaceGlass" />')).toEqual([1])
    expect(lines('<div className="bg-scrim" />')).toEqual([1])
  })

  it('flags through Tailwind variants', () => {
    expect(lines('<div className="hover:bg-surfaceGlass" />')).toEqual([1])
    expect(lines('<div className="hover:file:bg-surfaceGlass" />')).toEqual([1])
    expect(lines('<div className="md:hover:bg-scrim" />')).toEqual([1])
  })

  it('flags directional and non-background utilities', () => {
    expect(lines('<div className="border-t-scrim" />')).toEqual([1])
    expect(lines('<div className="divide-surfaceGlass" />')).toEqual([1])
    expect(lines('<div className="ring-scrim" />')).toEqual([1])
  })

  it('flags the CSS variable used with no alpha', () => {
    expect(lines('background: rgb(var(--surface-glass));')).toEqual([1])
    expect(lines('background: rgba(var(--scrim));')).toEqual([1])
  })

  it('🔴 still flags an UNDEFINED class-shaped name — the skip is not blanket', () => {
    // Same shape as `.tovis-overlay-scrim`, but no stylesheet defines it, so it
    // can only be a utility that will paint the token solid.
    expect(lines('<div className="some-made-up-scrim" />')).toEqual([1])
  })
})

describe('must NOT flag', () => {
  it('accepts a token carrying an alpha', () => {
    expect(lines('<div className="bg-surfaceGlass/10" />')).toEqual([])
    expect(lines('<div className="bg-scrim/70" />')).toEqual([])
    expect(lines('<div className="hover:border-surfaceGlass/12" />')).toEqual([])
  })

  it('accepts the CSS variable carrying an alpha', () => {
    expect(lines('background: rgb(var(--surface-glass) / 0.1);')).toEqual([])
    expect(lines('background: rgb(var(--scrim) / 0.7);')).toEqual([])
  })

  it('ignores identifiers that merely end in the token name', () => {
    expect(lines('const mySurfaceGlass = 1')).toEqual([])
    expect(lines('const scrim = 1')).toEqual([])
  })

  it('ignores a CSS class this repo defines — used, and declared', () => {
    expect(lines('<div className="tovis-overlay-scrim" />')).toEqual([])
    expect(lines('<span className="brand-pp-tile-scrim" aria-hidden />')).toEqual([])
    expect(lines('.brand-profile-cover-scrim {')).toEqual([])
  })

  it('ignores a defined class sitting alongside other utilities', () => {
    expect(
      lines('<div className="pointer-events-none absolute inset-0 tovis-overlay-scrim" />'),
    ).toEqual([])
  })
})

describe('non-vacuity — the real inputs, not a hand-built fixture', () => {
  it('derives the skip set from the repo’s own stylesheets', () => {
    // If this returned an empty set, every negative case above would still pass
    // while the guard flagged all three classes in CI.
    const defined = readDefinedCssClasses([
      path.join(process.cwd(), 'app/globals.css'),
      path.join(process.cwd(), 'lib/brand/brand.css'),
    ])

    expect(defined.has('tovis-overlay-scrim')).toBe(true)
    expect(defined.has('brand-pp-tile-scrim')).toBe(true)
    expect(defined.has('brand-profile-cover-scrim')).toBe(true)

    // …and does not hoover up things that are not classes.
    expect(defined.has('bg-scrim')).toBe(false)
  })

  it('reads both tint tokens out of lib/brand/types.ts', () => {
    // The guard is only as good as its token list, and that list is derived.
    expect(readTintTokens()).toEqual(
      expect.arrayContaining([
        { name: 'surfaceGlass', cssVar: '--surface-glass' },
        { name: 'scrim', cssVar: '--scrim' },
      ]),
    )
  })
})
