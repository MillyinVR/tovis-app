// lib/clients/technicalRecord.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { ClientConsentKind } from '@prisma/client'

import {
  canViewFormulaEntry,
  consentScopeForViewer,
  filterFormulaEntriesForViewer,
  isClientTechnicalRecordEnabled,
  isPatchTestCurrent,
  scopeConsentRecordsForViewer,
} from './technicalRecord'

describe('isClientTechnicalRecordEnabled', () => {
  afterEach(() => {
    delete process.env.ENABLE_CLIENT_TECHNICAL_RECORD
  })

  it('is off by default and for falsy values', () => {
    expect(isClientTechnicalRecordEnabled()).toBe(false)
    process.env.ENABLE_CLIENT_TECHNICAL_RECORD = '0'
    expect(isClientTechnicalRecordEnabled()).toBe(false)
    process.env.ENABLE_CLIENT_TECHNICAL_RECORD = 'off'
    expect(isClientTechnicalRecordEnabled()).toBe(false)
  })

  it('is on for 1/true/yes', () => {
    for (const v of ['1', 'true', 'YES']) {
      process.env.ENABLE_CLIENT_TECHNICAL_RECORD = v
      expect(isClientTechnicalRecordEnabled()).toBe(true)
    }
  })
})

describe('formula history — author-only', () => {
  it('only the author can view a formula entry', () => {
    expect(
      canViewFormulaEntry({ entryProfessionalId: 'p1', viewerProfessionalId: 'p1' }),
    ).toBe(true)
    expect(
      canViewFormulaEntry({ entryProfessionalId: 'p1', viewerProfessionalId: 'p2' }),
    ).toBe(false)
  })

  it('filters a mixed list down to the viewer’s own', () => {
    const entries = [
      { id: 'a', professionalId: 'p1' },
      { id: 'b', professionalId: 'p2' },
      { id: 'c', professionalId: 'p1' },
    ]
    expect(filterFormulaEntriesForViewer(entries, 'p1').map((e) => e.id)).toEqual([
      'a',
      'c',
    ])
  })
})

describe('consent scope — safety travels, artifact stays with author', () => {
  it('author sees full', () => {
    expect(
      consentScopeForViewer({
        recordProfessionalId: 'p1',
        recordKind: ClientConsentKind.SERVICE_WAIVER,
        viewerProfessionalId: 'p1',
      }),
    ).toBe('full')
  })

  it('another pro sees patch-test results (safety) but not waivers', () => {
    expect(
      consentScopeForViewer({
        recordProfessionalId: 'p1',
        recordKind: ClientConsentKind.PATCH_TEST,
        viewerProfessionalId: 'p2',
      }),
    ).toBe('safety')
    expect(
      consentScopeForViewer({
        recordProfessionalId: 'p1',
        recordKind: ClientConsentKind.SERVICE_WAIVER,
        viewerProfessionalId: 'p2',
      }),
    ).toBe('none')
    expect(
      consentScopeForViewer({
        recordProfessionalId: 'p1',
        recordKind: ClientConsentKind.GENERAL_CONSENT,
        viewerProfessionalId: 'p2',
      }),
    ).toBe('none')
  })

  it('scopeConsentRecordsForViewer drops invisible records and tags the rest', () => {
    const records = [
      { id: 'own-waiver', professionalId: 'p1', kind: ClientConsentKind.SERVICE_WAIVER },
      { id: 'other-patch', professionalId: 'p2', kind: ClientConsentKind.PATCH_TEST },
      { id: 'other-waiver', professionalId: 'p2', kind: ClientConsentKind.SERVICE_WAIVER },
    ]
    const scoped = scopeConsentRecordsForViewer(records, 'p1')
    expect(scoped.map((s) => [s.record.id, s.scope])).toEqual([
      ['own-waiver', 'full'],
      ['other-patch', 'safety'],
    ])
  })
})

describe('isPatchTestCurrent', () => {
  const now = new Date('2026-06-21T12:00:00.000Z')

  it('true only for a future validity date', () => {
    expect(isPatchTestCurrent(new Date('2026-07-01T00:00:00.000Z'), now)).toBe(true)
    expect(isPatchTestCurrent(new Date('2026-06-01T00:00:00.000Z'), now)).toBe(false)
    expect(isPatchTestCurrent(null, now)).toBe(false)
    expect(isPatchTestCurrent(undefined, now)).toBe(false)
  })
})
