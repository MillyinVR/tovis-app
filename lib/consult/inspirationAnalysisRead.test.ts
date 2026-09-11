import type { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { normalizeStoredConsultInspirationAnalysis } from './inspirationAnalysisRead'
import {
  CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION,
  CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
} from './inspirationVision'

// C2-6b — the normalizer reads BOTH the current version pair and the shipped
// one. A bare bump would have blanked every stored reading for the pro, the
// cards and the top line in the migrate-before-deploy window.

function known(value: string) {
  return {
    value,
    confidence: { min: 0.4, max: 0.65 },
    evidence: ['inspiration'],
    region: { x: 0.15, y: 0.2, w: 0.6, h: 0.5 },
  }
}

const ATTRIBUTES: Prisma.JsonObject = {
  baseLevel: known('LEVEL_6'),
  lightestLevel: known('LEVEL_9'),
  tone: known('COOL'),
  technique: known('BALAYAGE'),
  placement: known('MIDS_TO_ENDS'),
  rootBlend: known('SHADOW_ROOT'),
  finish: known('HIGH_SHINE'),
  dimension: { value: 'UNKNOWN', confidence: { min: 0.05, max: 0.3 }, evidence: [], region: null },
}

function row(args: {
  schemaVersion: number
  promptVersion: string | null
  payload: Prisma.JsonObject
}) {
  return {
    id: 'rev_1',
    payload: args.payload,
    schemaVersion: args.schemaVersion,
    promptVersion: args.promptVersion,
    model: 'fake-inspiration-model',
    createdAt: new Date('2026-09-11T00:00:00.000Z'),
  }
}

const V3: { schemaVersion: number; promptVersion: string; payload: Prisma.JsonObject } = {
  schemaVersion: 3,
  promptVersion: 'inspiration-hair-color-v3',
  payload: { schemaVersion: 3, inspirationId: 'insp_1', source: 'EXTERNAL_UPLOAD', attributes: ATTRIBUTES },
}

const V4: { schemaVersion: number; promptVersion: string; payload: Prisma.JsonObject } = {
  schemaVersion: CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
  promptVersion: CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION,
  payload: {
    schemaVersion: 4,
    inspirationId: 'insp_1',
    source: 'EXTERNAL_UPLOAD',
    attributes: ATTRIBUTES,
    credibilityFlags: ['PRO_LIGHTING', 'LIKELY_EDITED'],
  },
}

describe('normalizeStoredConsultInspirationAnalysis', () => {
  it('reads the SHIPPED v3 row, with no flags — the reading is not lost in the deploy window', () => {
    const read = normalizeStoredConsultInspirationAnalysis(row(V3))
    expect(read).not.toBeNull()
    expect(read?.schemaVersion).toBe(3)
    expect(read?.promptVersion).toBe('inspiration-hair-color-v3')
    expect(read?.attributes.technique.value).toBe('BALAYAGE')
    expect(read?.credibilityFlags).toEqual([])
  })

  it('reads a v4 row with its flags, in vocabulary order', () => {
    const read = normalizeStoredConsultInspirationAnalysis(row(V4))
    expect(read?.schemaVersion).toBe(4)
    expect(read?.credibilityFlags).toEqual(['LIKELY_EDITED', 'PRO_LIGHTING'])
    expect(read?.attributes.lightestLevel.value).toBe('LEVEL_9')
  })

  it('still refuses a v2 row and a mismatched pair — the window is two versions wide, not open', () => {
    expect(
      normalizeStoredConsultInspirationAnalysis(
        row({ schemaVersion: 2, promptVersion: 'inspiration-hair-color-v2', payload: V3.payload }),
      ),
    ).toBeNull()
    expect(
      normalizeStoredConsultInspirationAnalysis(
        row({ schemaVersion: 4, promptVersion: 'inspiration-hair-color-v3', payload: V4.payload }),
      ),
    ).toBeNull()
    expect(
      normalizeStoredConsultInspirationAnalysis(
        row({ schemaVersion: 3, promptVersion: 'inspiration-hair-color-v4', payload: V3.payload }),
      ),
    ).toBeNull()
  })

  it('filters a flag value the vocabulary does not know, and refuses a non-array', () => {
    expect(
      normalizeStoredConsultInspirationAnalysis(
        row({ ...V4, payload: { ...V4.payload, credibilityFlags: ['SINGLE_ANGLE', 'WIND_MACHINE'] } }),
      )?.credibilityFlags,
    ).toEqual(['SINGLE_ANGLE'])
    expect(
      normalizeStoredConsultInspirationAnalysis(
        row({ ...V4, payload: { ...V4.payload, credibilityFlags: 'SINGLE_ANGLE' } }),
      ),
    ).toBeNull()
  })
})
