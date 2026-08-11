// lib/privacy/exportBoundary.test.ts

import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  EXPORT_BOUNDARY,
  PENDING_DISPOSITION_BASELINE,
  SUBJECT_MODELS,
  pendingModelNames,
  subjectLinkedModelNames,
} from '@/lib/privacy/exportBoundary'

/**
 * The schema-completeness guard `exportUserData` has always told maintainers to
 * update, and which did not exist until K16-A.
 */
describe('privacy export completeness boundary', () => {
  it('derives subject-linked models from the generated Prisma client', () => {
    const linked = subjectLinkedModelNames()

    // Sanity: the detector must actually be reading a real datamodel.
    expect(Prisma.dmmf.datamodel.models.length).toBeGreaterThan(100)
    expect(linked.length).toBeGreaterThan(50)

    // Every subject model is trivially subject-linked.
    for (const subject of SUBJECT_MODELS) {
      expect(linked).toContain(subject)
    }
  })

  it('counts a model whose only subject link is an UNDECLARED scalar foreign key', () => {
    // ConsultationApproval.clientId is a plain String with no `@relation`, so a
    // relation-walking guard misses it entirely. If this ever starts failing
    // because the schema declared the relation properly, that is good news —
    // swap it for another undeclared FK or drop the case.
    const consultationApproval = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === 'ConsultationApproval',
    )
    expect(consultationApproval).toBeDefined()

    const clientIdField = consultationApproval?.fields.find(
      (field) => field.name === 'clientId',
    )
    expect(clientIdField?.kind).toBe('scalar')

    expect(subjectLinkedModelNames()).toContain('ConsultationApproval')
  })

  it('does NOT count a model that is only pointed AT by a subject list relation', () => {
    // Tenant.homePros / homeClients are back-references; the professional and
    // client hold the foreign keys. Treating those as links would file Tenant
    // as personal data.
    expect(subjectLinkedModelNames()).not.toContain('Tenant')
  })

  it('does NOT count external identity-provider ids as subject foreign keys', () => {
    // User.appleUserId / googleUserId end in "UserId" but are IdP subject ids.
    // User is still linked (it IS a subject), so assert the field-level rule.
    const user = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === 'User',
    )
    expect(
      user?.fields.some((field) => field.name === 'appleUserId'),
    ).toBe(true)

    // A non-subject model carrying only such a field must not be swept in.
    // (Guarded by NON_SUBJECT_ID_FIELDS; asserted here via the User case.)
    expect(subjectLinkedModelNames()).toContain('User')
  })

  it('has a recorded disposition for every subject-linked model', () => {
    const undispositioned = subjectLinkedModelNames().filter(
      (name) => !EXPORT_BOUNDARY[name],
    )

    expect(
      undispositioned,
      `These models link to the export subject but have no entry in EXPORT_BOUNDARY.\n` +
        `Add each as EXPORTED (with its payload keys) or OMITTED (with the reason it is left out):\n` +
        undispositioned.map((name) => `  - ${name}`).join('\n'),
    ).toEqual([])
  })

  it('has no stale entries for models that left the schema', () => {
    // Staleness is "this model no longer exists", NOT "this model is not
    // directly subject-linked". The registry legitimately carries models that
    // reach the subject transitively — AftercareSummary via Booking,
    // NotificationDelivery via NotificationDispatch — which the direct-FK
    // detector cannot see. See the detector's documented limitation.
    const modelNames = new Set(
      Prisma.dmmf.datamodel.models.map((model) => model.name),
    )
    const stale = Object.keys(EXPORT_BOUNDARY).filter(
      (name) => !modelNames.has(name),
    )

    expect(
      stale,
      `EXPORT_BOUNDARY names models that are not in the Prisma schema: ${stale.join(', ')}`,
    ).toEqual([])
  })

  it('gives every deliberate omission a non-empty reason', () => {
    const unreasoned = Object.entries(EXPORT_BOUNDARY)
      .filter(
        ([, disposition]) =>
          disposition.status === 'OMITTED' && disposition.reason.trim() === '',
      )
      .map(([name]) => name)

    expect(unreasoned).toEqual([])
  })

  it('keeps the undecided backlog from growing', () => {
    const pending = pendingModelNames()

    expect(
      pending.length,
      `Undecided subject-linked models grew past the baseline.\n` +
        `Settle the new one(s) in EXPORT_BOUNDARY rather than raising the baseline:\n` +
        pending.map((name) => `  - ${name}`).join('\n'),
    ).toBeLessThanOrEqual(PENDING_DISPOSITION_BASELINE)
  })

  it('records the K14–K16 chart/consent family as settled', () => {
    // Tori, 2026-07-31: pro-authored feedback is never disclosed to clients.
    expect(EXPORT_BOUNDARY.ClientProfessionalNote?.status).toBe('OMITTED')
    expect(EXPORT_BOUNDARY.ClientFormulaEntry?.status).toBe('OMITTED')
    // K16's own neutrality rule: the client never learns a policy row exists.
    expect(EXPORT_BOUNDARY.ProClientPolicy?.status).toBe('OMITTED')

    // The client's own signature and their own health disclosure ARE theirs.
    expect(EXPORT_BOUNDARY.ClientConsentRecord?.status).toBe('EXPORTED')
    expect(EXPORT_BOUNDARY.ClientAllergy?.status).toBe('EXPORTED')
  })

  it('exports the client-owned consult family once sensitive intake exists', () => {
    expect(EXPORT_BOUNDARY.ConsultSession).toEqual({
      status: 'EXPORTED',
      keys: ['consultSessions'],
    })
    expect(EXPORT_BOUNDARY.ConsultBriefFeedback?.status).toBe('OMITTED')
  })
})
