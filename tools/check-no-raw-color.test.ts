// Probe for the phase-7 raw-colour detector.
//
// The register's standing lesson about new detectors: give it a case that MUST
// be flagged and a case that MUST NOT, and look at what it stays silent about
// as hard as at what it reports. Two guards in this programme have shipped
// green while flagging the prose of a comment, and one invented forks in
// deliberately-open types because its parser read a body only to the first
// newline.
import { describe, expect, it } from 'vitest'

import { scanSource, stripComments } from './check-no-raw-color.mjs'

type Violation = {
  file: string
  line: number
  kind: 'raw-utility' | 'numeric-rgb' | 'alpha-in-bracket'
  matches: string[]
  snippet: string
}

const scan = (src: string): Violation[] => scanSource('probe.tsx', src) as Violation[]
const matches = (src: string): string[] => scan(src).flatMap((v) => v.matches)
// Asserting on a MAPPED array rather than on `found[0]` keeps the expectation
// total: an empty result fails loudly instead of tripping over `undefined`.
const kinds = (src: string): string[] => scan(src).map((v) => v.kind)
const lines = (src: string): number[] => scan(src).map((v) => v.line)

describe('stripComments', () => {
  it('preserves length and line count exactly', () => {
    const src = [
      'const a = 1 // border-white/10',
      '/* block',
      '   border-white/20',
      '   still block */',
      'const b = 2',
    ].join('\n')
    const out = stripComments(src) as string

    // Both halves matter. Equal length keeps every match offset true; equal
    // line count is what a earlier sweep in this programme lost, drifting every
    // reported line number after a /* */ block by the number of lines in it.
    expect(out.length).toBe(src.length)
    expect(out.split('\n').length).toBe(src.split('\n').length)
    expect(out).not.toContain('border-white')
  })

  it('does not treat an apostrophe inside a comment as opening a string', () => {
    // The exact shape that swallowed a whole JSX tag in an earlier sweep.
    const src = ["// it's fine", 'const cls = "border-white/10"'].join('\n')
    expect(matches(src)).toEqual(['border-white/10'])
  })

  it('leaves a URL in a string alone', () => {
    const src = 'const u = "https://example.com/x" // border-white/10'
    expect(matches(src)).toEqual([])
  })
})

describe('scanSource — must FLAG', () => {
  it('flags raw white/black utilities', () => {
    expect(matches('<div className="border-white/10" />')).toEqual(['border-white/10'])
    expect(matches('<div className="bg-black/70" />')).toEqual(['bg-black/70'])
    expect(matches('<div className="bg-white" />')).toEqual(['bg-white'])
  })

  it('flags them through a variant chain', () => {
    expect(matches('<div className="hover:border-white/20" />')).toEqual([
      'hover:border-white/20',
    ])
    expect(matches('<div className="md:focus-visible:ring-white/10" />')).toEqual([
      'md:focus-visible:ring-white/10',
    ])
    expect(matches('<div className="data-[open]:bg-black/60" />')).toEqual([
      'data-[open]:bg-black/60',
    ])
  })

  it('flags numeric rgb()/rgba(), reporting the whole colour', () => {
    expect(matches('const s = "0 10px 30px rgba(0,0,0,0.35)"')).toEqual([
      'rgba(0,0,0,0.35)',
    ])
    expect(matches('style={{ color: "rgb(255, 255, 255)" }}')).toEqual([
      'rgb(255, 255, 255)',
    ])
  })

  it('flags rgba() inside a Tailwind arbitrary value, where an UNDERSCORE precedes it', () => {
    // Tailwind spells spaces as `_`, and `_` is a word character, so a `\b`
    // left edge silently skipped every shadow in the repo — the single most
    // common shape this family takes.
    expect(matches('<div className="shadow-[0_10px_30px_rgba(0,0,0,0.35)]" />')).toEqual([
      'rgba(0,0,0,0.35)',
    ])
    expect(matches('<div className="shadow-[0_24px_90px_rgb(0_0_0/0.55)]" />')).toHaveLength(1)
  })

  it('still refuses to match rgb inside a longer identifier', () => {
    expect(matches('const myrgba = fn(0)')).toEqual([])
    expect(matches('const x = "xrgb(0,0,0)"')).toEqual([])
  })

  it('flags a template-interpolated alpha without swallowing the line', () => {
    // socialExportRender.ts's shape. The closing paren is past the `${…}`, so
    // the match stops at the interpolation — it must still be reported once.
    expect(kinds('ctx.fillStyle = `rgba(255, 255, 255, ${run.alpha})`')).toEqual([
      'numeric-rgb',
    ])
  })

  it('flags the alpha-inside-the-bracket shape and marks it as dropped', () => {
    expect(kinds('<div className="border-[rgb(var(--tone-success))/0.25]" />')).toEqual([
      'alpha-in-bracket',
    ])
  })

  // The shape that cost /search its focus ring: a token is three
  // space-separated channels, so the comma before the alpha makes the whole
  // declaration invalid and the browser drops it. NUMERIC_RGB cannot see it —
  // the digit it requires never arrives, because `var(` follows the paren.
  it('flags a token handed to rgba() with a COMMA before the alpha', () => {
    expect(
      kinds("'focus-within:shadow-[0_0_0_3px_rgba(var(--accent-primary),0.25)]'"),
    ).toEqual(['comma-alpha-on-var'])
  })

  it('flags it in an inline style too, not only in a class string', () => {
    expect(kinds("style={{ boxShadow: '0 0 0 3px rgba(var(--accent-primary), 0.25)' }}")).toEqual([
      'comma-alpha-on-var',
    ])
  })

  it('reports every raw colour on one line, once per line', () => {
    const found = scan(`const c = 'bg-black/45 text-white hover:bg-black/60'`)
    expect(found.map((v) => v.matches)).toEqual([
      ['bg-black/45', 'text-white', 'hover:bg-black/60'],
    ])
  })

  it('reports the ORIGINAL line number after a multi-line block comment', () => {
    const src = [
      'const a = 1',
      '/* one',
      '   two',
      '   three */',
      'const c = "border-white/10"',
    ].join('\n')
    expect(lines(src)).toEqual([5])
  })
})

describe('scanSource — must STAY SILENT', () => {
  it('ignores the compliant token forms', () => {
    expect(matches('<div className="border-surfaceGlass/10" />')).toEqual([])
    expect(matches('<div className="bg-overlay/70 text-onCta" />')).toEqual([])
    expect(matches('<div className="border-toneSuccess/25 bg-toneDanger/10" />')).toEqual([])
  })

  it('ignores rgb(var(--token)) — the whole point of the digit in the pattern', () => {
    expect(matches('const s = "rgb(var(--bg-primary))"')).toEqual([])
    expect(matches('const s = "rgb(var(--shadow-color) / 0.35)"')).toEqual([])
    expect(matches('const s = "rgba(var(--overlay) / 0.7)"')).toEqual([])
  })

  // The SLASH is what separates the fix from the bug, so the compliant spelling
  // of the very shape flagged above must stay silent — including the one this
  // repo writes most, inside a Tailwind arbitrary value.
  it('ignores a token with a SLASH alpha, which is the valid form', () => {
    expect(matches("'shadow-[0_10px_30px_rgb(var(--shadow-color)/0.35)]'")).toEqual([])
    expect(matches("'shadow-[0_0_0_3px_rgb(var(--accent-primary)/0.25)]'")).toEqual([])
  })

  it('ignores a raw colour that appears only in a comment', () => {
    // Both comment forms, because the guard reads files as text and two guards
    // in this repo have failed on the prose of a comment explaining a fix.
    expect(matches('// this used to be border-white/10')).toEqual([])
    expect(matches('/* was bg-black/70, see #919 */')).toEqual([])
    expect(matches('{/* border-white/10 */}')).toEqual([])
  })

  it('does not mistake a PR reference for a hex colour', () => {
    // `#919` / `#829` are pull-request numbers. A naive hex sweep flagged them.
    expect(matches('// fixed in #919, follow-up to #829')).toEqual([])
  })

  it('does not flag identifiers that merely contain a colour word', () => {
    expect(matches('const whiteLabelBrand = 1')).toEqual([])
    expect(matches('<div className="text-whitespace" />')).toEqual([])
    expect(matches('const x = "blackout-window"')).toEqual([])
  })

  it('does not flag a non-colour utility ending in the same word', () => {
    expect(matches('<div className="border-t-white/10x" />')).toEqual([])
  })
})
