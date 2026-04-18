// lib/clientActions/orchestrateClientActionDelivery.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ContactMethod,
  NotificationEventKey,
  NotificationRecipientKind,
} from '@prisma/client'

import { getClientActionDefinition } from './actionRegistry'
import { buildClientActionIdempotencyKeys } from './idempotency'
import { orchestrateClientActionDelivery } from './orchestrateClientActionDelivery'
import type { ClientActionOrchestrationInput } from './types'

function buildInput(
  overrides: Partial<ClientActionOrchestrationInput> = {},
): ClientActionOrchestrationInput {
  return {
    actionType: 'CONSULTATION_ACTION',
    refs: {
      bookingId: 'booking_123',
      clientId: 'client_123',
      professionalId: 'pro_123',
      consultationApprovalId: 'consult_123',
      aftercareId: null,
      inviteId: null,
    },
    recipient: {
      clientId: '  client_123  ',
      professionalId: '  pro_123  ',
      userId: null,
      invitedName: '  Tori Client  ',
      recipientEmail: '  Client@Example.com  ',
      recipientPhone: '  +1 (555) 123-4567  ',
      preferredContactMethod: null,
      timeZone: '  America/Los_Angeles  ',
    },
    resendMode: 'INITIAL_SEND',
    issuedByUserId: '  user_123  ',
    expiresAtOverride: null,
    metadata: { source: 'test' },
    tx: undefined,
    ...overrides,
  }
}

describe('lib/clientActions/orchestrateClientActionDelivery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds a complete orchestration plan for CLIENT_CLAIM_INVITE', () => {
    const input = buildInput({
      actionType: 'CLIENT_CLAIM_INVITE',
      refs: {
        bookingId: 'booking_123',
        clientId: 'client_123',
        professionalId: 'pro_123',
        consultationApprovalId: null,
        aftercareId: null,
        inviteId: 'invite_123',
      },
      resendMode: 'RESEND',
      recipient: {
        clientId: '  client_123  ',
        professionalId: '  pro_123  ',
        userId: null,
        invitedName: '  Tori Client  ',
        recipientEmail: '  client@example.com  ',
        recipientPhone: '  +1 (555) 123-4567  ',
        preferredContactMethod: ContactMethod.SMS,
        timeZone: '  America/Los_Angeles  ',
      },
      issuedByUserId: '  user_456  ',
      metadata: { reason: 'manual-invite-send' },
    })

    const result = orchestrateClientActionDelivery(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const expectedIdempotency = buildClientActionIdempotencyKeys({
      actionType: 'CLIENT_CLAIM_INVITE',
      refs: input.refs,
      recipient: {
        clientId: 'client_123',
        professionalId: 'pro_123',
        recipientEmail: 'client@example.com',
        recipientPhone: '+1 (555) 123-4567',
      },
      resendMode: 'RESEND',
    })

    expect(result.plan).toEqual({
      definition: getClientActionDefinition('CLIENT_CLAIM_INVITE'),
      refs: input.refs,
      recipient: {
        clientId: 'client_123',
        professionalId: 'pro_123',
        userId: null,
        invitedName: 'Tori Client',
        recipientEmail: 'client@example.com',
        recipientPhone: '+1 (555) 123-4567',
        preferredContactMethod: ContactMethod.SMS,
        timeZone: 'America/Los_Angeles',
      },
      resendMode: 'RESEND',
      idempotency: expectedIdempotency,
      resolvedDelivery: {
        method: ContactMethod.SMS,
        destinationSnapshot: '+1 (555) 123-4567',
        notificationEventKey: NotificationEventKey.CLIENT_CLAIM_INVITE,
        notificationRecipientKind: NotificationRecipientKind.CLIENT,
      },
      link: {
        target: 'CLAIM',
        pathPrefix: '/claim',
        requiresToken: true,
      },
      issuedByUserId: 'user_456',
      expiresAtOverride: null,
      metadata: { reason: 'manual-invite-send' },
      tx: undefined,
    })
  })

  it('builds a complete orchestration plan for AFTERCARE_ACCESS with an expiry override', () => {
    const expiresAtOverride = new Date('2026-04-20T12:00:00.000Z')

    const input = buildInput({
      actionType: 'AFTERCARE_ACCESS',
      refs: {
        bookingId: 'booking_123',
        clientId: 'client_123',
        professionalId: 'pro_123',
        consultationApprovalId: null,
        aftercareId: 'aftercare_123',
        inviteId: null,
      },
      expiresAtOverride,
      recipient: {
        clientId: 'client_123',
        professionalId: 'pro_123',
        userId: null,
        invitedName: '  Tori Client  ',
        recipientEmail: '  client@example.com  ',
        recipientPhone: '  +1 (555) 123-4567  ',
        preferredContactMethod: null,
        timeZone: '  America/Los_Angeles  ',
      },
    })

    const result = orchestrateClientActionDelivery(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.plan.definition).toBe(
      getClientActionDefinition('AFTERCARE_ACCESS'),
    )
    expect(result.plan.resolvedDelivery).toEqual({
      method: ContactMethod.EMAIL,
      destinationSnapshot: 'client@example.com',
      notificationEventKey: NotificationEventKey.AFTERCARE_READY,
      notificationRecipientKind: NotificationRecipientKind.CLIENT,
    })
    expect(result.plan.link).toEqual({
      target: 'AFTERCARE',
      pathPrefix: '/client/rebook',
      requiresToken: true,
    })
    expect(result.plan.expiresAtOverride).toBe(expiresAtOverride)
  })

  it('builds a complete orchestration plan for CONSULTATION_ACTION with email delivery', () => {
    const expiresAtOverride = new Date('2026-04-18T12:00:00.000Z')

    const input = buildInput({
      actionType: 'CONSULTATION_ACTION',
      expiresAtOverride,
    })

    const result = orchestrateClientActionDelivery(input)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.plan.definition).toBe(
      getClientActionDefinition('CONSULTATION_ACTION'),
    )
    expect(result.plan.resolvedDelivery).toEqual({
      method: ContactMethod.EMAIL,
      destinationSnapshot: 'Client@Example.com',
      notificationEventKey: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
      notificationRecipientKind: NotificationRecipientKind.CLIENT,
    })
    expect(result.plan.link).toEqual({
      target: 'CONSULTATION',
      pathPrefix: '/client/consultation',
      requiresToken: true,
    })
    expect(result.plan.expiresAtOverride).toBe(expiresAtOverride)
    expect(result.plan.issuedByUserId).toBe('user_123')
    expect(result.plan.metadata).toEqual({ source: 'test' })
  })

  it('returns recipient validation failure when clientId is missing', () => {
    const result = orchestrateClientActionDelivery(
      buildInput({
        actionType: 'CLIENT_CLAIM_INVITE',
        recipient: {
          clientId: '   ',
          professionalId: 'pro_123',
          userId: null,
          invitedName: 'Tori Client',
          recipientEmail: 'client@example.com',
          recipientPhone: '+15551234567',
          preferredContactMethod: null,
          timeZone: 'America/Los_Angeles',
        },
      }),
    )

    expect(result).toEqual({
      ok: false,
      code: 'CLIENT_ACTION_MISSING_CLIENT_ID',
      error:
        'clientActions/policies: CLIENT_CLAIM_INVITE requires recipient.clientId.',
    })
  })

  it('returns delivery failure when no usable destination exists', () => {
    const result = orchestrateClientActionDelivery(
      buildInput({
        actionType: 'CONSULTATION_ACTION',
        recipient: {
          clientId: 'client_123',
          professionalId: 'pro_123',
          userId: null,
          invitedName: 'Tori Client',
          recipientEmail: '   ',
          recipientPhone: '+15551234567',
          preferredContactMethod: null,
          timeZone: 'America/Los_Angeles',
        },
      }),
    )

    expect(result).toEqual({
      ok: false,
      code: 'CLIENT_ACTION_NO_DELIVERY_DESTINATION',
      error:
        'clientActions/policies: CONSULTATION_ACTION has no usable delivery destination for allowed contact methods [EMAIL].',
    })
  })

  it('returns expiry-policy failure when a non-token action receives an expiry override', () => {
    const result = orchestrateClientActionDelivery(
      buildInput({
        actionType: 'CLIENT_CLAIM_INVITE',
        expiresAtOverride: new Date('2026-04-20T12:00:00.000Z'),
      }),
    )

    expect(result).toEqual({
      ok: false,
      code: 'CLIENT_ACTION_TOKEN_POLICY_INVALID',
      error:
        'clientActions/policies: CLIENT_CLAIM_INVITE does not use ClientActionToken expiry overrides because token.required is false.',
    })
  })

  it('defaults metadata to null and issuedByUserId to null when omitted', () => {
    const result = orchestrateClientActionDelivery(
      buildInput({
        actionType: 'AFTERCARE_ACCESS',
        issuedByUserId: undefined,
        metadata: undefined,
        expiresAtOverride: new Date('2026-04-21T12:00:00.000Z'),
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.plan.issuedByUserId).toBeNull()
    expect(result.plan.metadata).toBeNull()
  })

  it('keeps the plan definition aligned with the registry for every supported action type', () => {
    const actionTypes: ClientActionOrchestrationInput['actionType'][] = [
      'CLIENT_CLAIM_INVITE',
      'AFTERCARE_ACCESS',
      'CONSULTATION_ACTION',
    ]

    for (const actionType of actionTypes) {
      const input =
        actionType === 'CLIENT_CLAIM_INVITE'
          ? buildInput({
              actionType,
              refs: {
                bookingId: 'booking_123',
                clientId: 'client_123',
                professionalId: 'pro_123',
                consultationApprovalId: null,
                aftercareId: null,
                inviteId: 'invite_123',
              },
              expiresAtOverride: null,
            })
          : buildInput({
              actionType,
              refs:
                actionType === 'AFTERCARE_ACCESS'
                  ? {
                      bookingId: 'booking_123',
                      clientId: 'client_123',
                      professionalId: 'pro_123',
                      consultationApprovalId: null,
                      aftercareId: 'aftercare_123',
                      inviteId: null,
                    }
                  : {
                      bookingId: 'booking_123',
                      clientId: 'client_123',
                      professionalId: 'pro_123',
                      consultationApprovalId: 'consult_123',
                      aftercareId: null,
                      inviteId: null,
                    },
              expiresAtOverride: new Date('2026-04-22T12:00:00.000Z'),
            })

      const result = orchestrateClientActionDelivery(input)

      expect(result.ok).toBe(true)
      if (!result.ok) continue

      expect(result.plan.definition).toBe(getClientActionDefinition(actionType))
    }
  })
})