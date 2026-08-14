import { ProfessionType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CARE_SECTION_LABELS,
  careSectionSuggestions,
} from '@/lib/aftercare/careSectionSuggestions'

describe('careSectionSuggestions', () => {
  it('gives every profession the schema declares a usable set of labels', () => {
    // The reason this file exists: the design frame hardcoded a colourist's
    // vocabulary. If a profession ever returns nothing, a pro in that trade
    // opens the aftercare form to a blank slate.
    for (const profession of Object.values(ProfessionType)) {
      const labels = careSectionSuggestions(profession)
      expect(labels.length).toBeGreaterThan(0)
      for (const label of labels) expect(label.trim()).not.toBe('')
    }
  })

  it('does NOT hand hair vocabulary to non-hair professions', () => {
    // The exact defect Tori caught in the design.
    const hairWords = ['wash', 'heat', 'styling', 'colour', 'color']
    for (const profession of [
      ProfessionType.MANICURIST,
      ProfessionType.LASH_TECHNICIAN,
      ProfessionType.ELECTROLOGIST,
      ProfessionType.MASSAGE_THERAPIST,
      ProfessionType.MAKEUP_ARTIST,
      ProfessionType.PERMANENT_MAKEUP_ARTIST,
      ProfessionType.ESTHETICIAN,
    ]) {
      const joined = careSectionSuggestions(profession).join(' ').toLowerCase()
      for (const word of hairWords) {
        expect(joined).not.toContain(word)
      }
    }
  })

  it('still gives a hairstylist the vocabulary the design drew', () => {
    expect(careSectionSuggestions(ProfessionType.HAIRSTYLIST)).toContain('Wash')
  })

  it('falls back rather than returning nothing for an absent profession', () => {
    // A pro with no profession recorded, and — the point of the fallback — a
    // ProfessionType added later that nobody remembers to map here.
    expect(careSectionSuggestions(null)).toEqual([
      ...DEFAULT_CARE_SECTION_LABELS,
    ])
    expect(careSectionSuggestions(undefined)).toEqual([
      ...DEFAULT_CARE_SECTION_LABELS,
    ])
  })

  it('returns a copy the caller cannot use to mutate the table', () => {
    const first = careSectionSuggestions(ProfessionType.MANICURIST)
    first.push('injected')
    expect(careSectionSuggestions(ProfessionType.MANICURIST)).not.toContain(
      'injected',
    )
  })
})
