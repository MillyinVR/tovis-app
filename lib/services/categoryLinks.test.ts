import { describe, expect, it } from 'vitest'

import { ADDITIONAL_CATEGORY_IDS_FIELD, parseAdditionalCategoryIds } from './categoryLinks'

describe('parseAdditionalCategoryIds', () => {
  it('is null when the field is absent — the caller must leave links untouched', () => {
    expect(parseAdditionalCategoryIds(new FormData())).toBeNull()
  })

  it('reads an empty value as "no additional categories"', () => {
    const form = new FormData()
    form.set(ADDITIONAL_CATEGORY_IDS_FIELD, '')
    expect(parseAdditionalCategoryIds(form)).toEqual([])
  })

  it('accepts repeated fields and comma-joined values, trimmed and de-duplicated', () => {
    const form = new FormData()
    form.append(ADDITIONAL_CATEGORY_IDS_FIELD, ' a , b')
    form.append(ADDITIONAL_CATEGORY_IDS_FIELD, 'b')
    form.append(ADDITIONAL_CATEGORY_IDS_FIELD, ',c,')
    expect(parseAdditionalCategoryIds(form)).toEqual(['a', 'b', 'c'])
  })
})
