import { ConsultSessionStatus } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { isFinalizeConsultAttributionOwned } from './consultAttribution'

describe('finalize consult attribution ownership', () => {
  const candidate = {
    clientId: 'client_1',
    professionalId: 'pro_1',
    serviceCategoryId: 'hair_color',
    status: ConsultSessionStatus.COMPLETED,
  }

  it('accepts only the completed same-client, same-pro, same-category consult', () => {
    expect(
      isFinalizeConsultAttributionOwned({
        candidate,
        clientId: 'client_1',
        professionalId: 'pro_1',
        serviceCategoryId: 'hair_color',
      }),
    ).toBe(true)

    for (const scope of [
      { clientId: 'other', professionalId: 'pro_1', serviceCategoryId: 'hair_color' },
      { clientId: 'client_1', professionalId: 'other', serviceCategoryId: 'hair_color' },
      { clientId: 'client_1', professionalId: 'pro_1', serviceCategoryId: 'brows' },
      { clientId: 'client_1', professionalId: 'pro_1', serviceCategoryId: null },
    ]) {
      expect(isFinalizeConsultAttributionOwned({ candidate, ...scope })).toBe(false)
    }
  })

  it('refuses a non-completed consult even when ownership matches', () => {
    expect(
      isFinalizeConsultAttributionOwned({
        candidate: { ...candidate, status: ConsultSessionStatus.ANALYZING },
        clientId: 'client_1',
        professionalId: 'pro_1',
        serviceCategoryId: 'hair_color',
      }),
    ).toBe(false)
  })
})
