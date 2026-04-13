// lib/clientActions/actionRegistry.test.ts

import { describe, expect, it } from 'vitest'
import {
  ClientActionTokenKind,
  ContactMethod,
  NotificationEventKey,
  NotificationRecipientKind,
} from '@prisma/client'

import { CONSULTATION_ACTION_TOKEN_EXPIRY_MS } from '@/lib/consultation/clientActionTokens'

import {
  AFTERCARE_ACCESS_TOKEN_EXPIRY_MS,
  CLIENT_ACTION_REGISTRY,
  getClientActionDefinition,
  getClientActionTokenKindForType,
  listClientActionDefinitions,
} from './actionRegistry'
import { CLIENT_ACTION_TYPES } from './types'

describe('lib/clientActions/actionRegistry', () => {
  describe('CLIENT_ACTION_REGISTRY', () => {
    it('defines a registry entry for every client action type', () => {
      expect(Object.keys(CLIENT_ACTION_REGISTRY).sort()).toEqual(
        [...CLIENT_ACTION_TYPES].sort(),
      )
    })

    it('defines the expected claim invite policy', () => {
      expect(CLIENT_ACTION_REGISTRY.CLIENT_CLAIM_INVITE).toEqual({
        type: 'CLIENT_CLAIM_INVITE',
        token: {
          required: false,
          kind: null,
          singleUse: false,
          expiresInMs: null,
          revokeOutstandingOnResend: false,
        },
        delivery: {
          allowedContactMethods: [ContactMethod.EMAIL, ContactMethod.SMS],
          preferredContactMethod: null,
          notificationEventKey: null,
          notificationRecipientKind: NotificationRecipientKind.CLIENT,
          createFreshDeliveryOnResend: true,
        },
        link: {
          target: 'CLAIM',
          pathPrefix: '/claim',
          requiresToken: true,
        },
      })
    })

    it('defines the expected aftercare access policy', () => {
      expect(CLIENT_ACTION_REGISTRY.AFTERCARE_ACCESS).toEqual({
        type: 'AFTERCARE_ACCESS',
        token: {
          required: true,
          kind: ClientActionTokenKind.AFTERCARE_ACCESS,
          singleUse: false,
          expiresInMs: AFTERCARE_ACCESS_TOKEN_EXPIRY_MS,
          revokeOutstandingOnResend: true,
        },
        delivery: {
          allowedContactMethods: [ContactMethod.EMAIL],
          preferredContactMethod: ContactMethod.EMAIL,
          notificationEventKey: NotificationEventKey.AFTERCARE_READY,
          notificationRecipientKind: NotificationRecipientKind.CLIENT,
          createFreshDeliveryOnResend: true,
        },
        link: {
          target: 'AFTERCARE',
          pathPrefix: '/client/rebook',
          requiresToken: true,
        },
      })
    })

    it('defines the expected consultation action policy', () => {
      expect(CLIENT_ACTION_REGISTRY.CONSULTATION_ACTION).toEqual({
        type: 'CONSULTATION_ACTION',
        token: {
          required: true,
          kind: ClientActionTokenKind.CONSULTATION_ACTION,
          singleUse: true,
          expiresInMs: CONSULTATION_ACTION_TOKEN_EXPIRY_MS,
          revokeOutstandingOnResend: true,
        },
        delivery: {
          allowedContactMethods: [ContactMethod.EMAIL],
          preferredContactMethod: ContactMethod.EMAIL,
          notificationEventKey:
            NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
          notificationRecipientKind: NotificationRecipientKind.CLIENT,
          createFreshDeliveryOnResend: true,
        },
        link: {
          target: 'CONSULTATION',
          pathPrefix: '/client/consultation',
          requiresToken: true,
        },
      })
    })

    it('keeps every registry definition keyed to its own type', () => {
      for (const type of CLIENT_ACTION_TYPES) {
        expect(CLIENT_ACTION_REGISTRY[type].type).toBe(type)
      }
    })
  })

  describe('getClientActionDefinition', () => {
    it('returns the claim invite definition', () => {
      expect(getClientActionDefinition('CLIENT_CLAIM_INVITE')).toBe(
        CLIENT_ACTION_REGISTRY.CLIENT_CLAIM_INVITE,
      )
    })

    it('returns the aftercare definition', () => {
      expect(getClientActionDefinition('AFTERCARE_ACCESS')).toBe(
        CLIENT_ACTION_REGISTRY.AFTERCARE_ACCESS,
      )
    })

    it('returns the consultation definition', () => {
      expect(getClientActionDefinition('CONSULTATION_ACTION')).toBe(
        CLIENT_ACTION_REGISTRY.CONSULTATION_ACTION,
      )
    })
  })

  describe('listClientActionDefinitions', () => {
    it('returns the definitions in CLIENT_ACTION_TYPES order', () => {
      expect(listClientActionDefinitions()).toEqual(
        CLIENT_ACTION_TYPES.map((type) => CLIENT_ACTION_REGISTRY[type]),
      )
    })
  })

  describe('getClientActionTokenKindForType', () => {
    it('returns null for claim invites because they do not use ClientActionTokenKind', () => {
      expect(getClientActionTokenKindForType('CLIENT_CLAIM_INVITE')).toBeNull()
    })

    it('returns AFTERCARE_ACCESS for aftercare actions', () => {
      expect(getClientActionTokenKindForType('AFTERCARE_ACCESS')).toBe(
        ClientActionTokenKind.AFTERCARE_ACCESS,
      )
    })

    it('returns CONSULTATION_ACTION for consultation actions', () => {
      expect(getClientActionTokenKindForType('CONSULTATION_ACTION')).toBe(
        ClientActionTokenKind.CONSULTATION_ACTION,
      )
    })
  })
})