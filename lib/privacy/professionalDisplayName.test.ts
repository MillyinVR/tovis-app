// lib/privacy/professionalDisplayName.test.ts
import { describe, expect, it } from 'vitest'

import {
  formatProfessionalPublicDisplayName,
  formatProfessionalPublicSearchText,
  pickProfessionalPublicDisplayName,
} from '@/lib/privacy/professionalDisplayName'

describe('professional public display-name privacy boundary', () => {
  it('prefers the public business name for display', () => {
    expect(
      formatProfessionalPublicDisplayName(
        {
          businessName: ' Glow Studio ',
          firstName: 'Amara',
          lastName: 'Okafor',
        },
        'Professional',
      ),
    ).toBe('Glow Studio')
  })

  it('falls back to public person-name parts when no business name exists', () => {
    expect(
      pickProfessionalPublicDisplayName({
        businessName: ' ',
        firstName: ' Amara ',
        lastName: ' Okafor ',
      }),
    ).toBe('Amara Okafor')
  })

  it('uses the requested fallback when no public name parts exist', () => {
    expect(
      formatProfessionalPublicDisplayName(
        {
          businessName: null,
          firstName: '',
          lastName: null,
        },
        'Professional',
      ),
    ).toBe('Professional')
  })

  it('keeps all public name tokens searchable', () => {
    expect(
      formatProfessionalPublicSearchText({
        businessName: 'Glow Studio',
        firstName: 'Amara',
        lastName: 'Okafor',
      }),
    ).toBe('Glow Studio Amara Okafor')
  })
})
