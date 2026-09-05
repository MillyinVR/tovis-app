import { describe, expect, it } from 'vitest'

import {
  GENERAL_SERVICE_INTAKE_PACK,
  GENERAL_SERVICE_INTAKE_PACK_V1,
} from './packs/generalService'
import { HAIR_COLOR_INTAKE_PACK, HAIR_COLOR_INTAKE_PACK_V2 } from './packs/hairColor'
import {
  HAIR_GENERAL_INTAKE_PACK,
  HAIR_GENERAL_INTAKE_PACK_V1,
} from './packs/hairGeneral'
import {
  CONSULT_INTAKE_FOLLOW_UP_TITLE,
  resolveConsultIntakeFollowUpPack,
} from './followUp'

describe('consult post-booking follow-up pack', () => {
  it('names the service in the question that could not name one before (B6)', () => {
    const named = resolveConsultIntakeFollowUpPack({
      intakePackId: 'hair-color',
      serviceName: 'Full Balayage',
    })
    expect(named?.title).toBe(CONSULT_INTAKE_FOLLOW_UP_TITLE)
    expect(named?.questions[0]).toMatchObject({
      key: 'service_experience',
      label: 'Have you had Full Balayage before?',
      requirement: 'REQUIRED',
    })
    // A Look whose linked service row is gone names nothing, and the question
    // falls back to the wording it has always had rather than to a hole.
    expect(
      resolveConsultIntakeFollowUpPack({
        intakePackId: 'hair-color',
        serviceName: null,
      })?.questions[0]?.label,
    ).toBe('Have you had this kind of service before?')
    expect(
      resolveConsultIntakeFollowUpPack({
        intakePackId: 'hair-color',
        serviceName: '   ',
      })?.questions[0]?.label,
    ).toBe('Have you had this kind of service before?')
  })

  it('carries exactly the questions each diet moved out', () => {
    expect(
      resolveConsultIntakeFollowUpPack({
        intakePackId: 'hair-color',
        serviceName: 'Balayage',
      })?.questions.map((entry) => entry.key),
    ).toEqual([
      'service_experience',
      'last_color_service_timing',
      'event_timing',
      'budget',
    ])
    expect(
      resolveConsultIntakeFollowUpPack({
        intakePackId: 'hair-general',
        serviceName: 'Tape-In Extensions',
      })?.questions.map((entry) => entry.key),
    ).toEqual([
      'service_experience',
      'last_service_timing',
      'maintenance_tolerance',
      'event_timing',
      'budget',
    ])
    expect(
      resolveConsultIntakeFollowUpPack({
        intakePackId: 'general-service',
        serviceName: 'Classic Lash Set',
      })?.questions.map((entry) => entry.key),
    ).toEqual([
      'service_experience',
      'last_service_timing',
      'maintenance_tolerance',
      'event_timing',
      'budget',
    ])
    expect(
      resolveConsultIntakeFollowUpPack({
        intakePackId: 'nails-v9',
        serviceName: 'Gel Manicure',
      }),
    ).toBeNull()
  })

  // The whole point of the diet is that nothing is LOST. Every question the
  // previous pack version asked is either still asked before the analysis or
  // asked again on the Brief.
  it('accounts for every question the diet removed', () => {
    const pairs = [
      ['hair-color', HAIR_COLOR_INTAKE_PACK, HAIR_COLOR_INTAKE_PACK_V2],
      ['hair-general', HAIR_GENERAL_INTAKE_PACK, HAIR_GENERAL_INTAKE_PACK_V1],
      ['general-service', GENERAL_SERVICE_INTAKE_PACK, GENERAL_SERVICE_INTAKE_PACK_V1],
    ] as const
    // Questions deliberately dropped outright, because the analysis reads the
    // answer off the photographs instead of asking for it.
    const answeredByThePhotos: Readonly<Record<string, readonly string[]>> = {
      'hair-color': [
        'current_color',
        'desired_color',
        // Folded into other_chemical_history, which is still asked.
        'perm_history',
        'relaxer_texturizer_history',
        'keratin_smoothing_history',
      ],
      'hair-general': ['current_length', 'hair_texture'],
      'general-service': [],
    }
    for (const [packId, current, previous] of pairs) {
      const stillAsked = new Set(current.questions.map((entry) => entry.key))
      const onTheBrief = new Set(
        resolveConsultIntakeFollowUpPack({ intakePackId: packId, serviceName: 'X' })
          ?.questions.map((entry) => entry.key) ?? [],
      )
      const dropped = new Set(answeredByThePhotos[packId])
      for (const question of previous.questions) {
        expect(
          stillAsked.has(question.key) ||
            onTheBrief.has(question.key) ||
            dropped.has(question.key),
          `${packId}.${question.key} is not asked, not on the Brief, and not listed as answered by the photos`,
        ).toBe(true)
      }
    }
  })
})
