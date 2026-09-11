import { describe, expect, it } from 'vitest'

import { consultProInspirationCredibilityCopy } from '@/lib/brand/consultProInspirationCredibilityCopy'
import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import type { ConsultInspirationCredibilityFlagDTO } from '@/lib/dto/consult'

import { CONSULT_INSPIRATION_CREDIBILITY_FLAGS } from './inspirationAttributes'
import {
  composeConsultInspirationCredibilityClientNote,
  composeConsultInspirationCredibilityProLine,
} from './inspirationCredibility'

// C2-6b — flags are enums on the wire and sentences on read. These are the
// two sentences, and the rule they both keep: never a code on a screen.

const copy = defaultClientConsultInspirationCopy

describe('the copy tables cover the vocabulary', () => {
  it('every flag has client words and pro words — a new flag with no words fails here', () => {
    for (const flag of CONSULT_INSPIRATION_CREDIBILITY_FLAGS) {
      expect(copy.credibility.flags[flag], `client clause for ${flag}`).toBeTruthy()
      expect(consultProInspirationCredibilityCopy.flags[flag], `pro phrase for ${flag}`).toBeTruthy()
    }
    // And nothing in either table names a flag the vocabulary does not have.
    for (const key of Object.keys(copy.credibility.flags)) {
      expect(CONSULT_INSPIRATION_CREDIBILITY_FLAGS).toContain(key)
    }
    for (const key of Object.keys(consultProInspirationCredibilityCopy.flags)) {
      expect(CONSULT_INSPIRATION_CREDIBILITY_FLAGS).toContain(key)
    }
  })
})

describe('composeConsultInspirationCredibilityClientNote', () => {
  it('is null when nothing was flagged', () => {
    expect(composeConsultInspirationCredibilityClientNote([], copy)).toBeNull()
  })

  it('says the one thing noticed, then the reassurance, in the app’s voice', () => {
    expect(composeConsultInspirationCredibilityClientNote(['LIKELY_EDITED'], copy)).toBe(
      'One thing about this picture: it looks edited or filtered. It’s still a great reference for the feeling and the direction — just know that some details may not be how real hair reflects, moves or grows.',
    )
  })

  it('joins several clauses in vocabulary order, whatever order the flags arrived in', () => {
    const note = composeConsultInspirationCredibilityClientNote(
      ['SINGLE_ANGLE', 'PRO_LIGHTING', 'LIKELY_EDITED'],
      copy,
    )
    expect(note).toBe(
      'One thing about this picture: it looks edited or filtered, it was lit like a photo shoot, and it only shows one angle. It’s still a great reference for the feeling and the direction — just know that some details may not be how real hair reflects, moves or grows.',
    )
  })

  it('never lets a code reach the client', () => {
    const note = composeConsultInspirationCredibilityClientNote(
      [...CONSULT_INSPIRATION_CREDIBILITY_FLAGS],
      copy,
    )
    expect(note).toBeTruthy()
    for (const flag of CONSULT_INSPIRATION_CREDIBILITY_FLAGS) {
      expect(note).not.toContain(flag)
    }
    // A flag with no words is left out, never echoed; alone it produces no sentence.
    const unknown = 'WIND_MACHINE' as ConsultInspirationCredibilityFlagDTO
    expect(composeConsultInspirationCredibilityClientNote([unknown], copy)).toBeNull()
    expect(
      composeConsultInspirationCredibilityClientNote([unknown, 'PRO_LIGHTING'], copy),
    ).toContain('it was lit like a photo shoot')
    expect(
      composeConsultInspirationCredibilityClientNote([unknown, 'PRO_LIGHTING'], copy),
    ).not.toContain('WIND_MACHINE')
  })
})

describe('composeConsultInspirationCredibilityProLine', () => {
  it('is null when nothing was flagged', () => {
    expect(composeConsultInspirationCredibilityProLine([])).toBeNull()
  })

  it('lists the flags as colourist phrases, in vocabulary order', () => {
    expect(
      composeConsultInspirationCredibilityProLine(['PRO_LIGHTING', 'LIKELY_EDITED']),
    ).toBe('Reference note: looks edited or filtered; lit like a photo shoot.')
    expect(composeConsultInspirationCredibilityProLine(['EXTENSIONS_LIKELY'])).toBe(
      'Reference note: extensions likely.',
    )
  })

  it('drops a flag with no words rather than echoing its code', () => {
    const unknown = 'WIND_MACHINE' as ConsultInspirationCredibilityFlagDTO
    expect(composeConsultInspirationCredibilityProLine([unknown])).toBeNull()
    expect(composeConsultInspirationCredibilityProLine([unknown, 'SINGLE_ANGLE'])).toBe(
      'Reference note: one angle only.',
    )
  })
})
