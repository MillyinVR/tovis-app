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

  it("defaults the fallback to 'Professional' and never exposes handle/email", () => {
    expect(
      formatProfessionalPublicDisplayName({
        businessName: null,
        firstName: null,
        lastName: null,
      }),
    ).toBe('Professional')
  })

  it('honors REAL_NAME preference over a set business name', () => {
    expect(
      pickProfessionalPublicDisplayName({
        businessName: 'Glow Studio',
        firstName: 'Amara',
        lastName: 'Okafor',
        handle: 'amara',
        nameDisplay: 'REAL_NAME',
      }),
    ).toBe('Amara Okafor')
  })

  it('honors HANDLE preference and prefixes with @', () => {
    expect(
      pickProfessionalPublicDisplayName({
        businessName: 'Glow Studio',
        firstName: 'Amara',
        lastName: 'Okafor',
        handle: 'glowbyamara',
        nameDisplay: 'HANDLE',
      }),
    ).toBe('@glowbyamara')
  })

  it('degrades a REAL_NAME pro with no real name to business, then handle', () => {
    expect(
      pickProfessionalPublicDisplayName({
        businessName: 'Glow Studio',
        firstName: '',
        lastName: '',
        handle: 'glow',
        nameDisplay: 'REAL_NAME',
      }),
    ).toBe('Glow Studio')

    expect(
      pickProfessionalPublicDisplayName({
        businessName: null,
        firstName: '',
        lastName: '',
        handle: 'glow',
        nameDisplay: 'HANDLE',
      }),
    ).toBe('@glow')
  })

  it('BUSINESS_NAME default never falls through to the handle', () => {
    expect(
      pickProfessionalPublicDisplayName({
        businessName: null,
        firstName: null,
        lastName: null,
        handle: 'glow',
        nameDisplay: 'BUSINESS_NAME',
      }),
    ).toBeNull()
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
