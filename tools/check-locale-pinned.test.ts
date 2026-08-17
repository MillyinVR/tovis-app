// Probe for the display-locale guard.
//
// The register's standing lesson about detectors: give it a case that MUST be
// flagged and a case that MUST NOT, and look at what it stays silent about as
// hard as at what it reports.
//
// Two silences matter here. The first is prose — this guard's own docstring
// quotes `Intl.DateTimeFormat(undefined, …)` and two locale literals, so it is
// its own most obvious false positive (third time this repo has been bitten by
// a guard reading a comment). The second is the timezone probe: `Intl
// .DateTimeFormat().resolvedOptions().timeZone` has no `new`, formats nothing,
// and reads the viewer's zone — flagging it would push a correct call onto the
// baseline and tell the next reader to "fix" it.
import { describe, expect, it } from 'vitest'

import {
  isGuardedPath,
  scanSource,
  stripComments,
  summarize,
} from './check-locale-pinned.mjs'

type Violation = { file: string; line: number; kind: string; token: string }

const scan = (src: string): Violation[] => scanSource('probe.ts', src) as Violation[]
const lines = (src: string): number[] => scan(src).map((v) => v.line)
const kinds = (src: string): string[] => scan(src).map((v) => v.kind)

describe('must flag — a locale literal outside lib/locale.ts', () => {
  it('flags a date formatter pinned to a literal', () => {
    expect(lines("formatInTimeZone(d, tz, opts, 'en-US')")).toEqual([1])
  })

  it('flags a locale that is not en-US — the register only ever grepped for one', () => {
    // `'en-CA'` was hiding two byte-identical `ymdInTimeZone` copies that the
    // phase's own inventory never saw, because it searched for `'en-US'`.
    expect(lines("formatInTimeZone(d, tz, opts, 'en-CA')")).toEqual([1])
  })

  it('flags a tag with a unicode extension subtag', () => {
    expect(lines("new Intl.DateTimeFormat('en-US-u-hc-h23', {})")).toEqual([1])
  })

  it('reports every literal on a line, not just the first', () => {
    expect(lines("const pair = ['en-US', 'fr-FR']")).toEqual([1, 1])
  })
})

describe('must flag — a formatter that lets the RUNTIME choose', () => {
  it('flags an explicit undefined locale', () => {
    expect(kinds('new Intl.NumberFormat(undefined, { style: "currency" })')).toEqual([
      'unpinned',
    ])
  })

  it('flags an omitted locale on toLocaleString', () => {
    expect(kinds('{count.toLocaleString()}')).toEqual(['unpinned'])
  })

  it('flags toLocaleDateString and toLocaleTimeString', () => {
    expect(kinds('d.toLocaleDateString(undefined, { month: "short" })')).toEqual([
      'unpinned',
    ])
    expect(kinds('d.toLocaleTimeString()')).toEqual(['unpinned'])
  })

  it('flags an empty-argument Intl constructor with whitespace inside the parens', () => {
    expect(kinds('new Intl.DateTimeFormat(  )')).toEqual(['unpinned'])
  })
})

describe('must NOT flag — prose, pinned calls, and the viewer-zone probe', () => {
  it('ignores a line comment that quotes the bad pattern', () => {
    expect(lines("// never write new Intl.NumberFormat(undefined, …) or 'en-US'")).toEqual(
      [],
    )
  })

  it('ignores a block comment, including a JSDoc one', () => {
    expect(lines("/**\n * Locale is 'en-US' here.\n */\nconst ok = 1")).toEqual([])
  })

  it('ignores a trailing comment but still sees the code before it', () => {
    expect(lines("const a = 1 // 'en-US' is wrong here")).toEqual([])
    expect(lines("const a = 'en-US' // this one is real")).toEqual([1])
  })

  it('does not treat a url inside a string as opening a comment', () => {
    expect(lines("const doc = 'https://x/y'\nconst l = 'en-US'")).toEqual([2])
  })

  it('ignores a call that passes the constant', () => {
    expect(scan('new Intl.NumberFormat(DISPLAY_LOCALE, {})')).toEqual([])
  })

  it('ignores a call that forwards a locale variable', () => {
    expect(scan('new Intl.DateTimeFormat(locale, { ...options, timeZone: tz })')).toEqual(
      [],
    )
  })

  it('ignores a date call that now relies on the default — the fix is a DELETION', () => {
    expect(scan('formatInTimeZone(d, tz, { month: "short" })')).toEqual([])
  })

  it("ignores the viewer's-timezone probe, which has no `new` and formats nothing", () => {
    expect(scan('const tz = Intl.DateTimeFormat().resolvedOptions().timeZone')).toEqual(
      [],
    )
  })

  it('ignores a bare two-letter string, which is any string in the language', () => {
    expect(scan("const code = 'US'\nconst other = 'en'")).toEqual([])
  })

  it('ignores the options TYPE, which is erased and formats nothing', () => {
    expect(scan('const o: Intl.DateTimeFormatOptions = { month: "short" }')).toEqual([])
  })

  it('ignores toLocaleUpperCase, which is not a display formatter here', () => {
    expect(scan("const s = name.toLocaleUpperCase()")).toEqual([])
  })
})

describe('stripComments preserves line numbers', () => {
  it('keeps a violation on its own line after a multi-line comment', () => {
    expect(lines("/* one\n   two\n   three */\nconst l = 'en-US'")).toEqual([4])
  })

  it('blanks comment text without collapsing the file', () => {
    expect(stripComments('a // b\nc').split('\n')).toHaveLength(2)
  })
})

describe('the baseline entry carries a COUNT, so a third literal still fails', () => {
  const entries = (src: string): string[] => [...summarize(scan(src)).values()]

  it('counts repeats of one token in one file as one entry with its count', () => {
    expect(entries("const a = 'en-US'\nconst b = 'en-US'")).toEqual([
      "probe.ts|literal|'en-US'|2",
    ])
  })

  it('separates two different tokens in the same file', () => {
    expect(entries("const a = 'en-US'\nconst b = 'en-US-u-hc-h23'").sort()).toEqual([
      "probe.ts|literal|'en-US'|1",
      "probe.ts|literal|'en-US-u-hc-h23'|1",
    ])
  })

  it('changes the entry when an occurrence is added — this is the whole point', () => {
    const two = entries("const a = 'en-US'\nconst b = 'en-US'")
    const three = entries("const a = 'en-US'\nconst b = 'en-US'\nconst c = 'en-US'")
    expect(two).not.toEqual(three)
  })
})

describe('scope', () => {
  it('has no opinion about lib/locale.ts, which holds the one literal', () => {
    expect(isGuardedPath('lib/locale.ts')).toBe(false)
  })

  it('has no opinion about tests', () => {
    expect(isGuardedPath('lib/formatInTimeZone.test.ts')).toBe(false)
    expect(isGuardedPath('app/x/__tests__/y.ts')).toBe(false)
  })

  it('does guard everything else, including the time layer', () => {
    expect(isGuardedPath('lib/formatInTimeZone.ts')).toBe(true)
    expect(isGuardedPath('lib/time/relativeTime.ts')).toBe(true)
    expect(isGuardedPath('app/pro/calendar/_utils/monthGrid.ts')).toBe(true)
    // Not lib/locale.ts — the prefix must be the FILE, not a stem.
    expect(isGuardedPath('lib/localeHelpers.ts')).toBe(true)
  })
})
