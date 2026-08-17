/**
 * Every React rendering of the mark, checked in the DOM it actually emits.
 *
 * The three components draw the mark for different reasons — the mark itself,
 * the footer's feather (glint deliberately dropped), the loading splash
 * (glint deliberately a brighter, pulsing white) — and for two months they
 * also disagreed about the plume, because each had hand-typed it. They now
 * compose lib/brand/eyeSvg.ts. This asserts the composition arrives intact,
 * not merely that the constants are right: a component can import the shared
 * artwork and still draw its own gradient two lines lower.
 */
import { describe, expect, it } from 'vitest'

// BrandLoader renders BrandWordmark, which reads the tenant-resolved brand
// from the provider and throws without one — so this has to be the real
// tree, not a bare render.
import { renderWithBrand as render } from '@/test/renderWithBrand'

import TovisFeatherMark from '@/app/_components/footer/TovisFeatherMark'

import BrandLoader from './BrandLoader'
import TovisEye from './TovisEye'
import { TOVIS_EYE_GLINT, TOVIS_EYE_PATH, TOVIS_EYE_STOPS } from './eyeSvg'

const EXPECTED_STOPS = TOVIS_EYE_STOPS.map((s) => [s.offset, s.color])

function markupOf(ui: React.ReactElement): HTMLElement {
  const { container } = render(ui)
  return container
}

/**
 * Per gradient, not per container: BrandLoader renders the wordmark, whose
 * dotless-i carries a second copy of the mark, so a tree can legitimately
 * hold more than one. Every one of them owes the shared plume.
 */
function gradientsIn(container: HTMLElement): Array<{
  id: string
  stops: string[][]
}> {
  return [...container.querySelectorAll('radialGradient')].map((gradient) => ({
    id: gradient.getAttribute('id') ?? '',
    stops: [...gradient.querySelectorAll('stop')].map((stop) => [
      stop.getAttribute('offset') ?? '',
      (stop.getAttribute('stop-color') ?? '').toUpperCase(),
    ]),
  }))
}

function markPathsIn(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('path')].filter(
    (p) => p.getAttribute('d') === TOVIS_EYE_PATH,
  )
}

const CASES: Array<[string, React.ReactElement]> = [
  ['TovisEye', <TovisEye key="eye" />],
  ['TovisFeatherMark', <TovisFeatherMark key="feather" />],
  ['BrandLoader', <BrandLoader key="loader" />],
]

describe.each(CASES)('%s', (_name, ui) => {
  it('draws the shared plume in every gradient it renders', () => {
    const gradients = gradientsIn(markupOf(ui))

    expect(gradients.length).toBeGreaterThan(0)
    for (const gradient of gradients) {
      expect(gradient.stops).toEqual(EXPECTED_STOPS)
    }
  })

  it('fills each mark path from a gradient that is actually in the tree', () => {
    const container = markupOf(ui)
    const ids = new Set(gradientsIn(container).map((g) => g.id))
    const paths = markPathsIn(container)

    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      const fill = path.getAttribute('fill') ?? ''
      expect(fill).toMatch(/^url\(#.+\)$/)
      expect(ids).toContain(fill.slice(5, -1))
    }
  })
})

describe('the glint, which is a per-call-site choice', () => {
  it('TovisEye draws the cream glint', () => {
    const circle = markupOf(<TovisEye />).querySelector('circle')

    expect(circle?.getAttribute('fill')).toBe(TOVIS_EYE_GLINT.color)
    expect(circle?.getAttribute('cx')).toBe(String(TOVIS_EYE_GLINT.cx))
    expect(circle?.getAttribute('r')).toBe(String(TOVIS_EYE_GLINT.r))
  })

  it('TovisFeatherMark draws no glint — the dropped pupil is the point', () => {
    const svg = markupOf(<TovisFeatherMark />).querySelector('svg')

    expect(svg?.querySelector('circle')).toBeNull()
  })

  it('BrandLoader keeps its brighter pulsing white', () => {
    const circle = markupOf(<BrandLoader />).querySelector('circle')

    expect(circle?.getAttribute('fill')).toBe('#FFFFFF')
    expect(circle?.getAttribute('cx')).toBe(String(TOVIS_EYE_GLINT.cx))
  })
})
