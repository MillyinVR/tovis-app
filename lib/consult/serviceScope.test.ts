import { ConsultServiceFamily } from '@prisma/client'
import { afterEach, describe, expect, it } from 'vitest'

import {
  CONSULT_SERVICE_FAMILIES,
  CONSULT_SERVICE_FAMILY_LABELS,
  CONSULT_SERVICE_SCOPE_DEFAULT,
  consultServiceScope,
  isConsultCategoryInScope,
  parseConsultServiceFamily,
} from './serviceScope'

describe('consult service scope', () => {
  afterEach(() => {
    delete process.env.AI_CONSULT_SERVICE_SCOPE
  })

  it('defaults to colour only until the final slice flips it', () => {
    expect(CONSULT_SERVICE_SCOPE_DEFAULT).toBe('HAIR_COLOR_ONLY')
    expect(consultServiceScope()).toBe('HAIR_COLOR_ONLY')
    expect(isConsultCategoryInScope({ slug: 'hair-color' })).toBe(true)
    expect(isConsultCategoryInScope({ slug: 'hair-extensions' })).toBe(false)
    expect(isConsultCategoryInScope({ slug: 'nails' })).toBe(false)
  })

  it('admits every category under ALL_SERVICES, but never one without a slug', () => {
    process.env.AI_CONSULT_SERVICE_SCOPE = 'ALL_SERVICES'
    expect(consultServiceScope()).toBe('ALL_SERVICES')
    for (const slug of ['hair-color', 'hair-extensions', 'cuts', 'nails', 'brows']) {
      expect(isConsultCategoryInScope({ slug })).toBe(true)
    }
    expect(isConsultCategoryInScope({ slug: '' })).toBe(false)
    expect(isConsultCategoryInScope({ slug: null })).toBe(false)
    expect(isConsultCategoryInScope({ slug: undefined })).toBe(false)
  })

  it('ignores an unrecognised override rather than treating it as open', () => {
    process.env.AI_CONSULT_SERVICE_SCOPE = 'EVERYTHING'
    expect(consultServiceScope()).toBe(CONSULT_SERVICE_SCOPE_DEFAULT)
    process.env.AI_CONSULT_SERVICE_SCOPE = ' HAIR_COLOR_ONLY '
    expect(consultServiceScope()).toBe('HAIR_COLOR_ONLY')
  })

  it('lists every schema family exactly once, each with a label', () => {
    const schemaFamilies = Object.values(ConsultServiceFamily)
    expect([...CONSULT_SERVICE_FAMILIES].sort()).toEqual([...schemaFamilies].sort())
    for (const family of schemaFamilies) {
      expect(CONSULT_SERVICE_FAMILY_LABELS[family]).toBeTruthy()
      expect(parseConsultServiceFamily(family)).toBe(family)
    }
    expect(parseConsultServiceFamily('hair')).toBeNull()
    expect(parseConsultServiceFamily(null)).toBeNull()
  })
})
