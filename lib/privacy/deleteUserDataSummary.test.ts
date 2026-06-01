import { describe, expect, it } from 'vitest'

import type { DeleteUserDataResult } from './deleteUserData'
import { summarizeDeleteUserDataResult } from './deleteUserDataSummary'

function makeResult(): DeleteUserDataResult {
  return {
    executedAt: '2026-05-31T12:00:00.000Z',
    mode: 'ANONYMIZE',
    subject: {
      userId: 'user_1',
      clientProfileId: 'client_1',
      professionalProfileId: 'pro_1',
    },
    requestedByUserId: 'admin_1',
    reason:
      'User emailed support with private context that should not be echoed.',
    actions: [
      {
        model: 'ClientAddress',
        action: 'DELETED',
        count: 2,
        notes: 'Private operational note.',
      },
      {
        model: 'ProfessionalLocation',
        action: 'DELETED',
        count: 1,
      },
      {
        model: 'BookingHold',
        action: 'SKIPPED',
        count: 0,
        notes: 'No matching holds.',
      },
      {
        model: 'ClientProfile',
        action: 'ANONYMIZED',
        count: 1,
      },
      {
        model: 'User',
        action: 'ANONYMIZED',
        count: 1,
      },
    ],
    limitations: [
      'Bookings are retained pending retention policy.',
      'Storage object bytes require a separate workflow.',
    ],
  }
}

describe('summarizeDeleteUserDataResult', () => {
  it('returns a route-safe summary of a delete result', () => {
    expect(summarizeDeleteUserDataResult(makeResult())).toEqual({
      executedAt: '2026-05-31T12:00:00.000Z',
      mode: 'ANONYMIZE',
      subject: {
        userId: 'user_1',
        clientProfileId: 'client_1',
        professionalProfileId: 'pro_1',
      },
      requestedByUserId: 'admin_1',
      actionCounts: {
        total: 5,
        wouldDelete: 0,
        wouldAnonymize: 0,
        deleted: 2,
        anonymized: 2,
        skipped: 1,
      },
      actions: [
        {
          model: 'ClientAddress',
          action: 'DELETED',
          count: 2,
        },
        {
          model: 'ProfessionalLocation',
          action: 'DELETED',
          count: 1,
        },
        {
          model: 'BookingHold',
          action: 'SKIPPED',
          count: 0,
        },
        {
          model: 'ClientProfile',
          action: 'ANONYMIZED',
          count: 1,
        },
        {
          model: 'User',
          action: 'ANONYMIZED',
          count: 1,
        },
      ],
      limitationsCount: 2,
    })
  })

  it('does not echo free-text reason, action notes, or limitation text', () => {
    const summary = summarizeDeleteUserDataResult(makeResult())
    const serialized = JSON.stringify(summary)

    expect(serialized).not.toContain('User emailed support')
    expect(serialized).not.toContain('Private operational note')
    expect(serialized).not.toContain('No matching holds')
    expect(serialized).not.toContain('Bookings are retained')
    expect(serialized).not.toContain('Storage object bytes')
  })

  it('counts dry-run actions separately from live mutation actions', () => {
    const result: DeleteUserDataResult = {
      ...makeResult(),
      mode: 'DRY_RUN',
      actions: [
        {
          model: 'ClientAddress',
          action: 'WOULD_DELETE',
          count: 2,
        },
        {
          model: 'ClientProfile',
          action: 'WOULD_ANONYMIZE',
          count: 1,
        },
        {
          model: 'ProfessionalProfile',
          action: 'SKIPPED',
          count: 0,
        },
      ],
      limitations: [],
    }

    expect(summarizeDeleteUserDataResult(result).actionCounts).toEqual({
      total: 3,
      wouldDelete: 1,
      wouldAnonymize: 1,
      deleted: 0,
      anonymized: 0,
      skipped: 1,
    })
  })
})
