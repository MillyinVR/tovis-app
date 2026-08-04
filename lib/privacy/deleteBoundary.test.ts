// lib/privacy/deleteBoundary.test.ts

import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  DELETE_BOUNDARY,
  modelsWithStatus,
  retainedNeedingReview,
} from '@/lib/privacy/deleteBoundary'
import { handledModelNames } from '@/lib/privacy/deleteRules'
import { subjectLinkedModelNames } from '@/lib/privacy/exportBoundary'

/**
 * The deletion twin of the export completeness guard.
 *
 * The load-bearing assertion here is the COVERAGE one: a registry that claims
 * a model is deleted, while the executor never touches it, is worse than no
 * registry at all — it reads as a decision and behaves as an oversight.
 */
describe('privacy deletion completeness boundary', () => {
  it('has a recorded disposition for every subject-linked model', () => {
    const undispositioned = subjectLinkedModelNames().filter(
      (name) => !DELETE_BOUNDARY[name],
    )

    expect(
      undispositioned,
      'These models link to the deletion subject but have no entry in DELETE_BOUNDARY.\n' +
        'A missing entry means this personal data SURVIVES an account deletion.\n' +
        'Add each as DELETE, ANONYMIZE, or RETAIN (with the reason it must be kept):\n' +
        undispositioned.map((name) => `  - ${name}`).join('\n'),
    ).toEqual([])
  })

  it('has no stale entries for models that left the schema', () => {
    const modelNames = new Set(
      Prisma.dmmf.datamodel.models.map((model) => model.name),
    )
    const stale = Object.keys(DELETE_BOUNDARY).filter(
      (name) => !modelNames.has(name),
    )

    expect(
      stale,
      `DELETE_BOUNDARY names models that are not in the Prisma schema: ${stale.join(', ')}`,
    ).toEqual([])
  })

  it('gives every disposition a non-empty reason', () => {
    const unreasoned = Object.entries(DELETE_BOUNDARY)
      .filter(([, disposition]) => disposition.reason.trim() === '')
      .map(([name]) => name)

    expect(unreasoned).toEqual([])
  })

  // ------------------------------------------------------------- coverage

  it('actually deletes or anonymizes every model it claims to', () => {
    const claimed = [
      ...modelsWithStatus('DELETE'),
      ...modelsWithStatus('ANONYMIZE'),
    ].sort()
    const handled = new Set(handledModelNames())

    const claimedButUnhandled = claimed.filter((name) => !handled.has(name))

    expect(
      claimedButUnhandled,
      'DELETE_BOUNDARY claims these models are deleted or anonymized, but the\n' +
        'executor never touches them — the registry is lying about what happens:\n' +
        claimedButUnhandled.map((name) => `  - ${name}`).join('\n'),
    ).toEqual([])
  })

  it('does not touch any model it has not dispositioned as DELETE or ANONYMIZE', () => {
    const claimed = new Set([
      ...modelsWithStatus('DELETE'),
      ...modelsWithStatus('ANONYMIZE'),
    ])

    const handledButUnclaimed = handledModelNames().filter(
      (name) => !claimed.has(name),
    )

    expect(
      handledButUnclaimed,
      'The executor writes to these models, but DELETE_BOUNDARY does not record\n' +
        'them as DELETE or ANONYMIZE. Either the write is wrong or the registry is:\n' +
        handledButUnclaimed.map((name) => `  - ${name}`).join('\n'),
    ).toEqual([])
  })

  it('never claims a model is BOTH retained and written', () => {
    const retained = new Set(modelsWithStatus('RETAIN'))
    const contradictions = handledModelNames().filter((name) =>
      retained.has(name),
    )

    expect(contradictions).toEqual([])
  })

  // -------------------------------------------------- deliberate decisions

  it('keeps the set of judgement-call retentions small and named', () => {
    // These are the RETAIN entries that are a product/legal decision rather
    // than a mechanical consequence of the schema. Changing this list should be
    // a deliberate act with Tori's sign-off, not a side effect.
    expect(retainedNeedingReview()).toEqual([
      'Booking',
      'Message',
      'ProfessionalPaymentSettings',
      'VerificationDocument',
    ])
  })

  it('deletes the records that would keep acting on a deleted account', () => {
    // Each of these is a live capability, not just stored data: a surviving row
    // keeps pushing, sending, publishing, or holding something hostage.
    expect(DELETE_BOUNDARY.DeviceToken?.status).toBe('DELETE')
    expect(DELETE_BOUNDARY.ScheduledClientNotification?.status).toBe('DELETE')
    expect(DELETE_BOUNDARY.CalendarFeedSubscription?.status).toBe('DELETE')
    expect(DELETE_BOUNDARY.HandleRegistration?.status).toBe('DELETE')
    expect(DELETE_BOUNDARY.ProfessionalSearchIndex?.status).toBe('DELETE')
    expect(DELETE_BOUNDARY.LookPost?.status).toBe('DELETE')
    // A live series would keep materializing future appointments.
    expect(DELETE_BOUNDARY.BookingSeries?.status).toBe('ANONYMIZE')
  })

  it('does not hard-delete models that other rows reference with Restrict', () => {
    // Proved the expensive way in tests/integration/account-deletion-boundary.test.ts:
    // deleting a ProfessionalLocation raises Booking_locationId_fkey. Anything
    // reachable by a Restrict foreign key must be ANONYMIZE, never DELETE.
    expect(DELETE_BOUNDARY.ProfessionalLocation?.status).toBe('ANONYMIZE')
    expect(DELETE_BOUNDARY.ProfessionalServiceOffering?.status).toBe('ANONYMIZE')
    expect(DELETE_BOUNDARY.NfcCard?.status).toBe('ANONYMIZE')
  })

  it('retains the other party‘s records rather than deleting them', () => {
    expect(DELETE_BOUNDARY.Booking?.status).toBe('RETAIN')
    expect(DELETE_BOUNDARY.Review?.status).toBe('RETAIN')
    expect(DELETE_BOUNDARY.Message?.status).toBe('RETAIN')
    expect(DELETE_BOUNDARY.ClientProfessionalNote?.status).toBe('RETAIN')
    expect(DELETE_BOUNDARY.BookingRefund?.status).toBe('RETAIN')
  })
})
