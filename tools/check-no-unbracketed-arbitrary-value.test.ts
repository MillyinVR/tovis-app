// Probe for the unbracketed-arbitrary-value guard.
//
// The bug this guard exists for: `max-w-420px` typechecks, lints, and reads
// like a width cap, but Tailwind's scanner does not recognise it as a
// utility pattern, so it emits ZERO CSS — a silently dead class. Ten of
// these shipped (client-parity-brief.md §0) before anything caught it. The
// negative cases matter as much as the positive ones: a regex broad enough
// to catch every prefix is also broad enough to snag a `calc()` expression
// already living inside a real bracketed value, which is exactly the shape
// `w-[min(380px,calc(100vw-24px))]` has.
import { describe, expect, it } from 'vitest'

import { scanSource } from './check-no-unbracketed-arbitrary-value.mjs'

const lines = (src: string): number[] => scanSource('probe.tsx', src).map((v) => v.line)

describe('must flag — an unbracketed arbitrary value', () => {
  it('flags every confirmed instance from the audit', () => {
    expect(lines('<div className="relative mx-auto w-full max-w-420px">')).toEqual([1])
    expect(lines('<div className="w-full max-w-540px flex-col px-4">')).toEqual([1])
    expect(lines('<main className="max-w-720px flex-col">')).toEqual([1])
    expect(lines('<div className="min-w-240px">')).toEqual([1])
  })

  it('flags each breakpoint variant on the same line independently', () => {
    const found = scanSource(
      'probe.tsx',
      '<div className="max-w-560px md:max-w-520px lg:max-w-560px xl:max-w-600px">',
    )
    expect(found).toHaveLength(1)
    expect(found[0].matches.sort()).toEqual(
      ['lg:max-w-560px', 'md:max-w-520px', 'max-w-560px', 'xl:max-w-600px'].sort(),
    )
  })

  it('flags through a Tailwind variant chain', () => {
    expect(lines('<div className="hover:w-320px" />')).toEqual([1])
    expect(lines('<div className="md:hover:max-h-480px" />')).toEqual([1])
  })

  it('flags non-width box-model utilities the same way', () => {
    expect(lines('<div className="top-64px" />')).toEqual([1])
    expect(lines('<div className="gap-24px" />')).toEqual([1])
    expect(lines('<div className="mt-12px" />')).toEqual([1])
    expect(lines('<div className="p-18px" />')).toEqual([1])
  })

  it('flags units other than px — the failure is missing brackets, not the unit', () => {
    expect(lines('<div className="max-w-40rem" />')).toEqual([1])
    expect(lines('<div className="w-90vw" />')).toEqual([1])
  })
})

describe('must NOT flag', () => {
  it('accepts the correctly bracketed form', () => {
    expect(lines('<div className="relative mx-auto w-full max-w-[420px]">')).toEqual([])
    expect(lines('<div className="min-w-[240px]">')).toEqual([])
  })

  it('ignores Tailwind’s built-in numeric scale (no unit suffix)', () => {
    expect(lines('<div className="w-4 h-96 p-2.5 gap-6 mx-2" />')).toEqual([])
  })

  it('does not reach into a calc() expression already inside real brackets', () => {
    // The `-24px` here is preceded by `vw`, not by a tracked prefix — this is
    // the exact false-positive shape a naive scan hit during development.
    expect(lines('<div className="w-[min(380px,calc(100vw-24px))]" />')).toEqual([])
    expect(
      lines('<div className="max-h-[calc(100vh-12px)] sm:max-h-[calc(100vh-80px)]" />'),
    ).toEqual([])
  })

  it('ignores untracked utility categories (font-size, radius) by design', () => {
    // Not part of any confirmed instance of this bug — scoped out on purpose,
    // see the header comment on the guard for why.
    expect(lines('<div className="text-28px rounded-12px" />')).toEqual([])
  })
})
