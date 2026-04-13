// lib/clientActions/policies.test.ts

import { describe, expect, it } from 'vitest'
import {
  ClientActionTokenKind,
  ContactMethod,
  NotificationEventKey,
} from '@prisma/client'

import { CONSULTATION_ACTION_TOKEN_EXPIRY_MS } from '@/lib/consultation/clientActionTokens'

import { AFTERCARE_ACCESS_TOKEN_EXPIRY_MS } from './actionRegistry'
import {
  getClientActionNotificationEventKey,
  getClientActionTokenKind,
  isIntentionalResend,
  isRetrySend,
  requiresClientActionToken,
  resolveClientActionDelivery,
  resolveClientActionDeliveryMethod,
  resolveClientActionDestinationSnapshot,
  resolveClientActionExpiresAt,
  shouldCreateFreshDeliveryOnResend,
  shouldRevokeOutstandingTokensOnResend,
  validateClientActionRecipient,
} from './policies'
import type { ClientActionRecipientSnapshot } from './types'

function buildRecipient(
  overrides: Partial<ClientActionRecipientSnapshot> = {},
): ClientActionRecipientSnapshot {
  return {
    clientId: 'client_123',
    professionalId: 'pro_123',
    userId: null,
    invitedName: '  Tori Client  ',
    recipientEmail: '  Client@Example.com  ',
    recipientPhone: '  +1 (555) 123-4567  ',
    preferredContactMethod: null,
    timeZone: '  America/Los_Angeles  ',
    ...overrides,
  }
}

describe('lib/clientActions/policies', () => {
  describe('token and event helpers', () => {
    it('reports whether each action type requires a ClientActionToken', () => {
      expect(requiresClientActionToken('CLIENT_CLAIM_INVITE')).toBe(false)
      expect(requiresClientActionToken('AFTERCARE_ACCESS')).toBe(true)
      expect(requiresClientActionToken('CONSULTATION_ACTION')).toBe(true)
    })

    it('returns the configured token kind for each action type', () => {
      expect(getClientActionTokenKind('CLIENT_CLAIM_INVITE')).toBeNull()
      expect(getClientActionTokenKind('AFTERCARE_ACCESS')).toBe(
        ClientActionTokenKind.AFTERCARE_ACCESS,
      )
      expect(getClientActionTokenKind('CONSULTATION_ACTION')).toBe(
        ClientActionTokenKind.CONSULTATION_ACTION,
      )
    })

    it('returns the configured notification event key for each action type', () => {
      expect(getClientActionNotificationEventKey('CLIENT_CLAIM_INVITE')).toBeNull()
      expect(getClientActionNotificationEventKey('AFTERCARE_ACCESS')).toBe(
        NotificationEventKey.AFTERCARE_READY,
      )
      expect(getClientActionNotificationEventKey('CONSULTATION_ACTION')).toBe(
        NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
      )
    })

    it('returns the resend and delivery policy flags', () => {
      expect(shouldRevokeOutstandingTokensOnResend('CLIENT_CLAIM_INVITE')).toBe(
        false,
      )
      expect(shouldRevokeOutstandingTokensOnResend('AFTERCARE_ACCESS')).toBe(
        true,
      )
      expect(shouldRevokeOutstandingTokensOnResend('CONSULTATION_ACTION')).toBe(
        true,
      )

      expect(shouldCreateFreshDeliveryOnResend('CLIENT_CLAIM_INVITE')).toBe(
        true,
      )
      expect(shouldCreateFreshDeliveryOnResend('AFTERCARE_ACCESS')).toBe(true)
      expect(shouldCreateFreshDeliveryOnResend('CONSULTATION_ACTION')).toBe(
        true,
      )
    })

    it('distinguishes resend from retry', () => {
      expect(isIntentionalResend('INITIAL_SEND')).toBe(false)
      expect(isIntentionalResend('RETRY')).toBe(false)
      expect(isIntentionalResend('RESEND')).toBe(true)

      expect(isRetrySend('INITIAL_SEND')).toBe(false)
      expect(isRetrySend('RESEND')).toBe(false)
      expect(isRetrySend('RETRY')).toBe(true)
    })
  })

  describe('validateClientActionRecipient', () => {
    it('normalizes a valid recipient snapshot', () => {
      const result = validateClientActionRecipient(
        'CLIENT_CLAIM_INVITE',
        buildRecipient(),
      )

      expect(result).toEqual({
        ok: true,
        value: {
          clientId: 'client_123',
          professionalId: 'pro_123',
          userId: null,
          invitedName: 'Tori Client',
          recipientEmail: 'Client@Example.com',
          recipientPhone: '+1 (555) 123-4567',
          preferredContactMethod: null,
          timeZone: 'America/Los_Angeles',
        },
      })
    })

    it('fails when clientId is blank', () => {
      const result = validateClientActionRecipient(
        'AFTERCARE_ACCESS',
        buildRecipient({ clientId: '   ' }),
      )

      expect(result).toEqual({
        ok: false,
        code: 'CLIENT_ACTION_MISSING_CLIENT_ID',
        error:
          'clientActions/policies: AFTERCARE_ACCESS requires recipient.clientId.',
      })
    })

    it('fails when professionalId is blank', () => {
      const result = validateClientActionRecipient(
        'CONSULTATION_ACTION',
        buildRecipient({ professionalId: '   ' }),
      )

      expect(result).toEqual({
        ok: false,
        code: 'CLIENT_ACTION_MISSING_PROFESSIONAL_ID',
        error:
          'clientActions/policies: CONSULTATION_ACTION requires recipient.professionalId.',
      })
    })
  })

  describe('resolveClientActionDeliveryMethod', () => {
    it('uses an allowed override when the destination exists', () => {
      const result = resolveClientActionDeliveryMethod({
        actionType: 'CLIENT_CLAIM_INVITE',
        recipient: buildRecipient(),
        preferredContactMethodOverride: ContactMethod.SMS,
      })

      expect(result).toEqual({
        ok: true,
        value: ContactMethod.SMS,
      })
    })

    it('fails when an override is not allowed for the action', () => {
      const result = resolveClientActionDeliveryMethod({
        actionType: 'CONSULTATION_ACTION',
        recipient: buildRecipient(),
        preferredContactMethodOverride: ContactMethod.SMS,
      })

      expect(result).toEqual({
        ok: false,
        code: 'CLIENT_ACTION_CONTACT_METHOD_NOT_ALLOWED',
        error:
          'clientActions/policies: CONSULTATION_ACTION does not allow contact method SMS.',
      })
    })

    it('fails when an override destination is missing', () => {
      const result = resolveClientActionDeliveryMethod({
        actionType: 'CLIENT_CLAIM_INVITE',
        recipient: buildRecipient({ recipientPhone: '   ' }),
        preferredContactMethodOverride: ContactMethod.SMS,
      })

      expect(result).toEqual({
        ok: false,
        code: 'CLIENT_ACTION_NO_DELIVERY_DESTINATION',
        error:
          'clientActions/policies: CLIENT_CLAIM_INVITE cannot use SMS because the destination snapshot is missing.',
      })
    })

    it('uses recipient preferred contact method before registry preference', () => {
      const result = resolveClientActionDeliveryMethod({
        actionType: 'CLIENT_CLAIM_INVITE',
        recipient: buildRecipient({
          preferredContactMethod: ContactMethod.SMS,
        }),
      })

      expect(result).toEqual({
        ok: true,
        value: ContactMethod.SMS,
      })
    })

    it('uses registry preference when recipient preference is null', () => {
      const result = resolveClientActionDeliveryMethod({
        actionType: 'AFTERCARE_ACCESS',
        recipient: buildRecipient({
          preferredContactMethod: null,
        }),
      })

      expect(result).toEqual({
        ok: true,
        value: ContactMethod.EMAIL,
      })
    })

    it('falls back to another allowed method when recipient preference is unavailable', () => {
      const result = resolveClientActionDeliveryMethod({
        actionType: 'CLIENT_CLAIM_INVITE',
        recipient: buildRecipient({
          preferredContactMethod: ContactMethod.SMS,
          recipientPhone: null,
        }),
      })

      expect(result).toEqual({
        ok: true,
        value: ContactMethod.EMAIL,
      })
    })

    it('fails when no allowed destination exists', () => {
      const result = resolveClientActionDeliveryMethod({
        actionType: 'CLIENT_CLAIM_INVITE',
        recipient: buildRecipient({
          recipientEmail: '   ',
          recipientPhone: null,
        }),
      })

      expect(result).toEqual({
        ok: false,
        code: 'CLIENT_ACTION_NO_DELIVERY_DESTINATION',
        error:
          'clientActions/policies: CLIENT_CLAIM_INVITE has no usable delivery destination for allowed contact methods [EMAIL, SMS].',
      })
    })
  })

  describe('resolveClientActionDestinationSnapshot', () => {
    it('returns the normalized email destination snapshot', () => {
      const result = resolveClientActionDestinationSnapshot({
        method: ContactMethod.EMAIL,
        recipient: buildRecipient(),
      })

      expect(result).toEqual({
        ok: true,
        value: 'Client@Example.com',
      })
    })

    it('returns the normalized sms destination snapshot', () => {
      const result = resolveClientActionDestinationSnapshot({
        method: ContactMethod.SMS,
        recipient: buildRecipient(),
      })

      expect(result).toEqual({
        ok: true,
        value: '+1 (555) 123-4567',
      })
    })

    it('fails when the destination snapshot is missing', () => {
      const result = resolveClientActionDestinationSnapshot({
        method: ContactMethod.EMAIL,
        recipient: buildRecipient({ recipientEmail: '   ' }),
      })

      expect(result).toEqual({
        ok: false,
        code: 'CLIENT_ACTION_NO_DELIVERY_DESTINATION',
        error:
          'clientActions/policies: destination snapshot is missing for contact method EMAIL.',
      })
    })
  })

  describe('resolveClientActionDelivery', () => {
    it('returns the full resolved delivery payload for claim invite sms', () => {
      const result = resolveClientActionDelivery({
        actionType: 'CLIENT_CLAIM_INVITE',
        recipient: buildRecipient({
          preferredContactMethod: ContactMethod.SMS,
        }),
      })

      expect(result).toEqual({
        ok: true,
        value: {
          method: ContactMethod.SMS,
          destinationSnapshot: '+1 (555) 123-4567',
          notificationEventKey: null,
          notificationRecipientKind: 'CLIENT',
        },
      })
    })

    it('returns the full resolved delivery payload for aftercare email', () => {
      const result = resolveClientActionDelivery({
        actionType: 'AFTERCARE_ACCESS',
        recipient: buildRecipient(),
      })

      expect(result).toEqual({
        ok: true,
        value: {
          method: ContactMethod.EMAIL,
          destinationSnapshot: 'Client@Example.com',
          notificationEventKey: NotificationEventKey.AFTERCARE_READY,
          notificationRecipientKind: 'CLIENT',
        },
      })
    })

    it('returns an error when delivery cannot be resolved', () => {
      const result = resolveClientActionDelivery({
        actionType: 'CONSULTATION_ACTION',
        recipient: buildRecipient({
          recipientEmail: null,
          recipientPhone: '+15551234567',
        }),
      })

      expect(result).toEqual({
        ok: false,
        code: 'CLIENT_ACTION_NO_DELIVERY_DESTINATION',
        error:
          'clientActions/policies: CONSULTATION_ACTION has no usable delivery destination for allowed contact methods [EMAIL].',
      })
    })
  })

  describe('resolveClientActionExpiresAt', () => {
    it('returns null for actions that do not use ClientActionToken expiry', () => {
      const now = new Date('2026-04-13T12:00:00.000Z')

      const result = resolveClientActionExpiresAt({
        actionType: 'CLIENT_CLAIM_INVITE',
        now,
      })

      expect(result).toEqual({
        ok: true,
        value: null,
      })
    })

    it('fails when a non-token action receives an expiresAtOverride', () => {
      const now = new Date('2026-04-13T12:00:00.000Z')
      const override = new Date('2026-04-14T12:00:00.000Z')

      const result = resolveClientActionExpiresAt({
        actionType: 'CLIENT_CLAIM_INVITE',
        now,
        expiresAtOverride: override,
      })

      expect(result).toEqual({
        ok: false,
        code: 'CLIENT_ACTION_TOKEN_POLICY_INVALID',
        error:
          'clientActions/policies: CLIENT_CLAIM_INVITE does not use ClientActionToken expiry overrides because token.required is false.',
      })
    })

    it('uses the default aftercare expiry window when no override is provided', () => {
      const now = new Date('2026-04-13T12:00:00.000Z')

      const result = resolveClientActionExpiresAt({
        actionType: 'AFTERCARE_ACCESS',
        now,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value?.toISOString()).toBe(
        new Date(now.getTime() + AFTERCARE_ACCESS_TOKEN_EXPIRY_MS).toISOString(),
      )
    })

    it('uses the default consultation expiry window when no override is provided', () => {
      const now = new Date('2026-04-13T12:00:00.000Z')

      const result = resolveClientActionExpiresAt({
        actionType: 'CONSULTATION_ACTION',
        now,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value?.toISOString()).toBe(
        new Date(
          now.getTime() + CONSULTATION_ACTION_TOKEN_EXPIRY_MS,
        ).toISOString(),
      )
    })

    it('uses a valid future override when provided', () => {
      const now = new Date('2026-04-13T12:00:00.000Z')
      const override = new Date('2026-04-20T12:00:00.000Z')

      const result = resolveClientActionExpiresAt({
        actionType: 'CONSULTATION_ACTION',
        now,
        expiresAtOverride: override,
      })

      expect(result).toEqual({
        ok: true,
        value: override,
      })
    })

    it('fails when the override is not in the future', () => {
      const now = new Date('2026-04-13T12:00:00.000Z')
      const override = new Date('2026-04-13T11:59:59.000Z')

      const result = resolveClientActionExpiresAt({
        actionType: 'AFTERCARE_ACCESS',
        now,
        expiresAtOverride: override,
      })

      expect(result).toEqual({
        ok: false,
        code: 'CLIENT_ACTION_TOKEN_POLICY_INVALID',
        error:
          'clientActions/policies: AFTERCARE_ACCESS expiresAtOverride must be in the future.',
      })
    })

    it('fails when a token action has an invalid expiry policy', () => {
      const now = new Date('2026-04-13T12:00:00.000Z')

      const result = resolveClientActionExpiresAt({
        actionType: 'AFTERCARE_ACCESS',
        now,
        expiresAtOverride: new Date('invalid'),
      })

      expect(result).toEqual({
        ok: false,
        code: 'CLIENT_ACTION_TOKEN_POLICY_INVALID',
        error:
          'clientActions/policies: AFTERCARE_ACCESS received an invalid expiresAtOverride.',
      })
    })
  })
})