// lib/consult/lookAnchor.test.ts
import { afterEach, describe, expect, it } from 'vitest'

import { resolveConsultLookAnchor } from './lookAnchor'

function look(
  service: {
    id: string
    name: string
    category: { id: string; name: string; slug: string }
  } | null,
) {
  return {
    id: 'look_1',
    professionalId: 'pro_1',
    serviceId: service?.id ?? null,
    service,
  }
}

const HAIR_COLOR = {
  id: 'svc_1',
  name: 'Balayage',
  category: { id: 'cat_hair_color', name: 'Hair Color', slug: 'hair-color' },
}

describe('resolveConsultLookAnchor', () => {
  afterEach(() => {
    delete process.env.AI_CONSULT_SERVICE_SCOPE
  })

  it('anchors a look in ANY category once the scope is ALL_SERVICES', () => {
    process.env.AI_CONSULT_SERVICE_SCOPE = 'ALL_SERVICES'
    expect(
      resolveConsultLookAnchor(
        look({
          ...HAIR_COLOR,
          category: { id: 'cat_nails', name: 'Nails', slug: 'nails' },
        }),
      ),
    ).toEqual({
      ok: true,
      lookPostId: 'look_1',
      professionalId: 'pro_1',
      serviceCategoryId: 'cat_nails',
    })
    // A look still has to be LINKED — a category is what a consult is about.
    expect(resolveConsultLookAnchor(look(null))).toEqual({
      ok: false,
      reason: 'LOOK_SERVICE_UNLINKED',
    })
  })

  it('derives the pro and the category from the look linkage', () => {
    expect(resolveConsultLookAnchor(look(HAIR_COLOR))).toEqual({
      ok: true,
      lookPostId: 'look_1',
      professionalId: 'pro_1',
      serviceCategoryId: 'cat_hair_color',
    })
  })

  it('REFUSES a look with no service linkage instead of guessing a category', () => {
    expect(resolveConsultLookAnchor(look(null))).toEqual({
      ok: false,
      reason: 'LOOK_SERVICE_UNLINKED',
    })
  })

  it('refuses a look linked outside the founder pilot vertical', () => {
    expect(
      resolveConsultLookAnchor(
        look({
          ...HAIR_COLOR,
          category: { id: 'cat_nails', name: 'Nails', slug: 'nails' },
        }),
      ),
    ).toEqual({ ok: false, reason: 'LOOK_VERTICAL_NOT_ENABLED' })
  })

  it('the pro is the look’s own professional, not the author', () => {
    const resolved = resolveConsultLookAnchor({
      ...look(HAIR_COLOR),
      professionalId: 'visited_pro',
    })
    expect(resolved).toMatchObject({ ok: true, professionalId: 'visited_pro' })
  })
})
