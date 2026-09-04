import { describe, expect, it } from 'vitest'

import { ConsultWriteError } from './errors'
import {
  LEGACY_HAIR_COLOR_ANALYSIS_SCHEMA_VERSION,
  normalizeStoredConsultAnalysisPayload,
} from './analysisRevision'

const confidence = { min: 0.4, max: 0.7 }
const observed = (value: string, evidence: string[] = ['hair_back']) => ({
  value,
  confidence: value === 'UNKNOWN' ? { min: 0, max: 0.25 } : confidence,
  evidence,
})

function profile() {
  return {
    skinUndertone: observed('NEUTRAL', ['face_front']),
    contrastLevel: observed('MEDIUM', ['face_front']),
    colorSeason: observed('UNKNOWN', []),
    faceProportion: observed('BALANCED', ['face_front']),
    jawline: observed('SOFTLY_ROUNDED', ['face_side']),
    foreheadProportion: observed('BALANCED', ['face_side']),
    featureBalance: observed('SOFT', ['face_front']),
    eyeShape: observed('HOODED', ['eyes_closeup']),
    eyeSpacing: observed('BALANCED', ['eyes_closeup']),
    browDensity: observed('FULL', ['eyes_closeup']),
    browShape: observed('SOFT_ARCH', ['eyes_closeup']),
  }
}

function styleDirections() {
  return [
    'HAIR_COLOR_HARMONY',
    'CUT_AND_SHAPE',
    'BANGS',
    'BROWS',
    'LASHES',
    'MAKEUP',
    'COLOR_PALETTE',
  ].map((domain) => ({
    domain,
    title: 'A soft direction',
    direction: 'Discuss a soft direction together.',
    whyItFlatters: 'Soft balance favours blended choices.',
    confidence,
    evidence: ['face_front'],
    discussWithProfessional: true,
  }))
}

const lens = {
  goal: 'A noticeable change.',
  history: 'History from the intake.',
  constraints: 'Constraints were not collected and are unknown.',
  maintenance: 'Maintenance tolerance was not collected and is unknown.',
  appointmentContext: 'Timing and budget from the intake.',
  achievability: 'REQUIRES_PRO_ASSESSMENT',
  achievabilityReason: 'Needs an in-person check.',
  discussWithProfessional: true,
}

const core = {
  baseLevel: { value: 'LEVEL_4', confidence, evidence: ['hair_back'] },
  lightestLevel: { value: 'LEVEL_5', confidence, evidence: ['hair_back'] },
  currentTone: observed('MIXED'),
  visibleCondition: observed('NO_VISIBLE_CONCERN'),
  density: observed('UNKNOWN', []),
  texture: observed('WAVY'),
}

const reference = {
  type: 'SERVICE',
  serviceId: 'svc_balayage',
  serviceCategoryId: 'cat_color',
}

describe('normalizeStoredConsultAnalysisPayload', () => {
  it('reads a current-schema row as written', () => {
    const payload = {
      profile: profile(),
      styleDirections: styleDirections(),
      core,
      serviceLens: lens,
      safetyFlags: [],
      recommendations: [
        {
          serviceIntent: 'SERVICE',
          serviceName: 'Balayage',
          title: 'Hand-painted dimension',
          rationale: 'Suits the blended direction.',
          achievability: 'Confirm in person.',
          discussWithProfessional: true,
          reference,
        },
      ],
    }
    const result = normalizeStoredConsultAnalysisPayload(payload, 4)
    expect(result.core.baseLevel.value).toBe('LEVEL_4')
    expect(result.core.lightestLevel.value).toBe('LEVEL_5')
    expect(result.serviceLens.goal).toBe('A noticeable change.')
    expect(result.recommendations[0]).toMatchObject({
      serviceIntent: 'SERVICE',
      serviceName: 'Balayage',
      reference,
    })
  })

  it('upgrades a schema-2 row: the colour lens becomes the service lens, colour intents become kinds, and the level pair is named', () => {
    const legacy = {
      profile: profile(),
      styleDirections: styleDirections(),
      // A real schema-2 core: one positional level pair, not two named ends.
      core: {
        currentLevel: { min: 4, max: 5, confidence, evidence: ['hair_back'] },
        currentTone: observed('MIXED'),
        visibleCondition: observed('NO_VISIBLE_CONCERN'),
        density: observed('UNKNOWN', []),
        texture: observed('WAVY'),
      },
      hairColorLens: lens,
      safetyFlags: [],
      recommendations: [
        {
          serviceIntent: 'BALAYAGE',
          title: 'Hand-painted dimension',
          rationale: 'Suits the blended direction.',
          achievability: 'Confirm in person.',
          discussWithProfessional: true,
          reference,
        },
        {
          serviceIntent: 'COLOR_CONSULTATION',
          title: 'Professional color review',
          rationale: 'Review together.',
          achievability: 'Decided after review.',
          discussWithProfessional: true,
          reference: { type: 'SERVICE_CATEGORY', serviceId: null, serviceCategoryId: 'cat_color' },
        },
        {
          serviceIntent: 'PATCH_TEST',
          title: 'Patch Test',
          rationale: 'Because of a reaction.',
          achievability: 'Reviewed first.',
          discussWithProfessional: true,
          reference: { ...reference, serviceId: 'svc_patch' },
        },
      ],
    }
    const result = normalizeStoredConsultAnalysisPayload(
      legacy,
      LEGACY_HAIR_COLOR_ANALYSIS_SCHEMA_VERSION,
    )
    expect(result.serviceLens).toEqual(lens)
    // `min` becomes the base and `max` the lightest — the reading the old
    // screen rendered, and the only one a reader can honour.
    expect(result.core.baseLevel).toEqual({
      value: 'LEVEL_4',
      confidence,
      evidence: ['hair_back'],
    })
    expect(result.core.lightestLevel.value).toBe('LEVEL_5')
    expect(
      result.recommendations.map((item) => [item.serviceIntent, item.serviceName]),
    ).toEqual([
      ['SERVICE', 'Service from the professional’s menu'],
      ['CONSULTATION', null],
      ['PATCH_TEST', null],
    ])
    // The stored reference — which service it actually was — survives.
    expect(result.recommendations[0]?.reference).toEqual(reference)
  })

  it('refuses a schema it does not know, including the versions that never compiled', () => {
    const payload = {
      profile: profile(),
      styleDirections: styleDirections(),
      core,
      serviceLens: lens,
      safetyFlags: [],
      recommendations: [],
    }
    expect(() => normalizeStoredConsultAnalysisPayload(payload, 1)).toThrowError(
      ConsultWriteError,
    )
    // Schema 3 is not readable and never needs to be: its provider schema was
    // refused by the API, so no row was ever written under it.
    expect(() => normalizeStoredConsultAnalysisPayload(payload, 3)).toThrowError(
      ConsultWriteError,
    )
    expect(() =>
      normalizeStoredConsultAnalysisPayload({ ...payload, hairColorLens: lens }, 4),
    ).toThrowError(ConsultWriteError)
  })
})
