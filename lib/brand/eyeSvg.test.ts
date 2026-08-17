// lib/brand/eyeSvg.test.ts
//
// The mark's artwork is shared by import everywhere it CAN be (see
// eyeSvg.ts). Two copies cannot import: app/icon.svg and the file
// assets.mark.src names. This pins them to the same source of truth, which is
// the only thing standing between them and the drift that put two different
// versions of the mark into production for two months.
//
// The file list is SWEPT, not enumerated, so a seventh static copy is covered
// the day it lands rather than the day someone remembers this file.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { tovisBrand } from './brands/tovis'
import {
  TOVIS_EYE_GLINT,
  TOVIS_EYE_GRADIENT,
  TOVIS_EYE_PATH,
  TOVIS_EYE_STOPS,
} from './eyeSvg'

const REPO_ROOT = process.cwd()

/** Every .svg under these roots that draws the mark. */
const SWEEP_ROOTS = ['app', 'public']

function svgFilesUnder(dir: string): string[] {
  const out: string[] = []

  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue

    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...svgFilesUnder(full))
    else if (entry.endsWith('.svg')) out.push(full)
  }

  return out
}

function staticCopiesOfTheMark(): Array<{ rel: string; src: string }> {
  return SWEEP_ROOTS.flatMap((root) => svgFilesUnder(path.join(REPO_ROOT, root)))
    .map((full) => ({
      rel: path.relative(REPO_ROOT, full),
      src: readFileSync(full, 'utf8'),
    }))
    .filter((f) => f.src.includes(TOVIS_EYE_PATH))
    .sort((a, b) => a.rel.localeCompare(b.rel))
}

/** The gradient stops a piece of SVG markup declares, in document order. */
function stopsIn(svg: string): Array<{ offset: string; color: string }> {
  return [
    ...svg.matchAll(/offset=["']([^"']+)["']\s*stop-color=["']([^"']+)["']/g),
  ].map((m) => ({ offset: m[1] ?? '', color: (m[2] ?? '').toUpperCase() }))
}

const EXPECTED_STOPS = TOVIS_EYE_STOPS.map((s) => ({
  offset: s.offset,
  color: s.color.toUpperCase(),
}))

describe('the artwork itself', () => {
  // Everything else in this file compares a copy against these constants, so
  // nothing else would notice the constants moving — every mark in the app
  // would restyle together and every assertion would still agree. This is the
  // one place the values are written out rather than derived.
  it('is the plume the rebrand drew', () => {
    expect(TOVIS_EYE_PATH).toBe('M50 4 C78 27 78 73 50 96 C22 73 22 27 50 4 Z')
    expect(TOVIS_EYE_GRADIENT).toEqual({ cx: '48%', cy: '40%', r: '64%' })
    expect(TOVIS_EYE_STOPS).toEqual([
      { offset: '0%', color: '#FFF0C2' },
      { offset: '20%', color: '#F2B43E' },
      { offset: '46%', color: '#15C9A8' },
      { offset: '72%', color: '#1574C4' },
      { offset: '100%', color: '#6B4BE6' },
    ])
    expect(TOVIS_EYE_GLINT).toEqual({
      cx: 42,
      cy: 38,
      r: 6.5,
      color: '#FFF6E2',
    })
  })
})

describe('the static copies of the mark', () => {
  const copies = staticCopiesOfTheMark()

  it('finds the copies that cannot import the artwork', () => {
    // Guards against a sweep that silently matches nothing and passes.
    expect(copies.map((c) => c.rel)).toEqual([
      'app/icon.svg',
      'public/brand/tovis/mark.svg',
    ])
  })

  it.each(copies.map((c) => c.rel))('%s draws the shared plume', (rel) => {
    const src = copies.find((c) => c.rel === rel)?.src ?? ''

    expect(stopsIn(src)).toEqual(EXPECTED_STOPS)
    expect(src).toContain(`cx="${TOVIS_EYE_GRADIENT.cx}"`)
    expect(src).toContain(`cy="${TOVIS_EYE_GRADIENT.cy}"`)
    expect(src).toContain(`r="${TOVIS_EYE_GRADIENT.r}"`)
  })

  it.each(copies.map((c) => c.rel))('%s draws the shared glint', (rel) => {
    const src = copies.find((c) => c.rel === rel)?.src ?? ''

    expect(src).toContain(`cx="${TOVIS_EYE_GLINT.cx}"`)
    expect(src).toContain(`cy="${TOVIS_EYE_GLINT.cy}"`)
    expect(src).toContain(`r="${TOVIS_EYE_GLINT.r}"`)
    expect(src).toContain(`fill="${TOVIS_EYE_GLINT.color}"`)
  })
})

describe('assets.mark', () => {
  // src and svg are documented as the same artwork in two transports. They
  // were not: src pointed at the rebrand's mark and svg at a retyped copy
  // with the plume 2% further out and a paler core, so the favicon, the
  // apple-icon and every OG card rendered a different mark from the footer.
  it('renders the same artwork through src as through svg', () => {
    const fromFile = readFileSync(
      path.join(REPO_ROOT, 'public', tovisBrand.assets.mark.src),
      'utf8',
    )

    expect(stopsIn(fromFile)).toEqual(stopsIn(tovisBrand.assets.mark.svg ?? ''))
    expect(stopsIn(fromFile)).toEqual(EXPECTED_STOPS)
  })
})
