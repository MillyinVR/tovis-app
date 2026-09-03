import { ConsultServiceFamily } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { resolveConsultServiceProfile } from './serviceProfile'

function category(
  overrides: Partial<Parameters<typeof resolveConsultServiceProfile>[0]> = {},
) {
  return {
    id: 'cat_1',
    slug: 'hair-extensions',
    name: 'Extensions',
    isActive: true,
    consultFamily: ConsultServiceFamily.HAIR,
    ...overrides,
  }
}

describe('resolveConsultServiceProfile', () => {
  it('carries the category and picks the intake pack from slug then family', () => {
    expect(resolveConsultServiceProfile(category())).toMatchObject({
      family: 'HAIR',
      categoryId: 'cat_1',
      categorySlug: 'hair-extensions',
      categoryName: 'Extensions',
      intakePack: { id: 'hair-general' },
    })
    expect(
      resolveConsultServiceProfile(category({ slug: 'hair-color', name: 'Color' })),
    ).toMatchObject({ intakePack: { id: 'hair-color' } })
  })

  it('gives a category nobody has modelled the generic pack', () => {
    expect(
      resolveConsultServiceProfile(
        category({
          slug: 'lash-lift',
          name: 'Lash lift',
          consultFamily: ConsultServiceFamily.BROWS_LASHES,
        }),
      ),
    ).toMatchObject({ family: 'BROWS_LASHES', intakePack: { id: 'general-service' } })
    expect(
      resolveConsultServiceProfile(
        category({
          slug: 'brand-new',
          name: 'Brand new',
          consultFamily: ConsultServiceFamily.OTHER,
        }),
      ),
    ).toMatchObject({ family: 'OTHER', intakePack: { id: 'general-service' } })
  })
})
