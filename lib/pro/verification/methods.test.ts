import { ProfessionType, VerificationDocumentType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  verificationDocTypeLabel,
  verificationMethodsForProfession,
} from './methods'

describe('verificationMethodsForProfession', () => {
  it('offers license + ID to licensed professions', () => {
    const methods = verificationMethodsForProfession(
      ProfessionType.COSMETOLOGIST,
    )

    expect(methods.map((m) => m.type)).toEqual([
      VerificationDocumentType.LICENSE,
      VerificationDocumentType.ID_CARD,
    ])
  })

  it('offers makeup certificates + ID to makeup artists', () => {
    const methods = verificationMethodsForProfession(
      ProfessionType.MAKEUP_ARTIST,
    )

    expect(methods.map((m) => m.type)).toEqual([
      VerificationDocumentType.MAKEUP_PRIMARY,
      VerificationDocumentType.MAKEUP_SECONDARY,
      VerificationDocumentType.ID_CARD,
    ])
  })

  it('falls back to license + ID when profession is unknown', () => {
    expect(verificationMethodsForProfession(null).map((m) => m.type)).toEqual([
      VerificationDocumentType.LICENSE,
      VerificationDocumentType.ID_CARD,
    ])
  })

  it('every method has user-facing copy', () => {
    for (const profession of Object.values(ProfessionType)) {
      for (const method of verificationMethodsForProfession(profession)) {
        expect(method.title.length).toBeGreaterThan(0)
        expect(method.description.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('verificationDocTypeLabel', () => {
  it('labels every document type', () => {
    for (const type of Object.values(VerificationDocumentType)) {
      expect(verificationDocTypeLabel(type).length).toBeGreaterThan(0)
    }
  })
})
