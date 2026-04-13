// lib/clientActions/idempotency.test.ts

import { describe, expect, it } from 'vitest'

import {
  buildClientActionBaseKey,
  buildClientActionIdempotencyKeys,
  buildClientActionRecipientFingerprint,
  buildClientActionSendKey,
  listClientActionIdempotencyAnchors,
} from './idempotency'
import type { ClientActionIdempotencyInput } from './types'

function buildInput(
  overrides: Partial<ClientActionIdempotencyInput> = {},
): ClientActionIdempotencyInput {
  return {
    actionType: 'CONSULTATION_ACTION',
    refs: {
      bookingId: 'booking_123',
      consultationApprovalId: 'consult_123',
      clientId: 'client_123',
      professionalId: 'pro_123',
      inviteId: null,
      aftercareId: null,
    },
    recipient: {
      clientId: 'client_123',
      professionalId: 'pro_123',
      recipientEmail: 'Client@Example.com',
      recipientPhone: '+1 (555) 123-4567',
    },
    resendMode: 'INITIAL_SEND',
    ...overrides,
  }
}

describe('lib/clientActions/idempotency', () => {
  describe('buildClientActionRecipientFingerprint', () => {
    it('returns the same fingerprint for semantically identical recipient data', () => {
      const first = buildClientActionRecipientFingerprint({
        clientId: 'client_123',
        professionalId: 'pro_123',
        recipientEmail: ' Client@Example.com ',
        recipientPhone: '+1 (555) 123-4567',
      })

      const second = buildClientActionRecipientFingerprint({
        clientId: 'client_123',
        professionalId: 'pro_123',
        recipientEmail: 'client@example.com',
        recipientPhone: '+15551234567',
      })

      expect(first).toBe(second)
    })

    it('returns a different fingerprint when recipient identity changes', () => {
      const first = buildClientActionRecipientFingerprint({
        clientId: 'client_123',
        professionalId: 'pro_123',
        recipientEmail: 'client@example.com',
        recipientPhone: '+15551234567',
      })

      const second = buildClientActionRecipientFingerprint({
        clientId: 'client_999',
        professionalId: 'pro_123',
        recipientEmail: 'client@example.com',
        recipientPhone: '+15551234567',
      })

      expect(first).not.toBe(second)
    })

    it('treats blank recipient snapshots as null values', () => {
      const first = buildClientActionRecipientFingerprint({
        clientId: 'client_123',
        professionalId: 'pro_123',
        recipientEmail: '   ',
        recipientPhone: '   ',
      })

      const second = buildClientActionRecipientFingerprint({
        clientId: 'client_123',
        professionalId: 'pro_123',
        recipientEmail: null,
        recipientPhone: null,
      })

      expect(first).toBe(second)
    })
  })

  describe('buildClientActionBaseKey', () => {
    it('returns the same base key for semantically identical inputs', () => {
      const first = buildClientActionBaseKey(
        buildInput({
          refs: {
            bookingId: ' booking_123 ',
            consultationApprovalId: ' consult_123 ',
            clientId: ' client_123 ',
            professionalId: ' pro_123 ',
            inviteId: null,
            aftercareId: null,
          },
          recipient: {
            clientId: 'client_123',
            professionalId: 'pro_123',
            recipientEmail: ' Client@Example.com ',
            recipientPhone: '+1 (555) 123-4567',
          },
        }),
      )

      const second = buildClientActionBaseKey(
        buildInput({
          refs: {
            bookingId: 'booking_123',
            consultationApprovalId: 'consult_123',
            clientId: 'client_123',
            professionalId: 'pro_123',
            inviteId: null,
            aftercareId: null,
          },
          recipient: {
            clientId: 'client_123',
            professionalId: 'pro_123',
            recipientEmail: 'client@example.com',
            recipientPhone: '+15551234567',
          },
        }),
      )

      expect(first).toBe(second)
      expect(first.startsWith('client-action:consultation-action:')).toBe(true)
    })

    it('returns a different base key when the action type changes', () => {
      const first = buildClientActionBaseKey(
        buildInput({ actionType: 'CONSULTATION_ACTION' }),
      )

      const second = buildClientActionBaseKey(
        buildInput({ actionType: 'AFTERCARE_ACCESS' }),
      )

      expect(first).not.toBe(second)
    })

    it('returns a different base key when entity references change', () => {
      const first = buildClientActionBaseKey(buildInput())

      const second = buildClientActionBaseKey(
        buildInput({
          refs: {
            bookingId: 'booking_999',
            consultationApprovalId: 'consult_123',
            clientId: 'client_123',
            professionalId: 'pro_123',
            inviteId: null,
            aftercareId: null,
          },
        }),
      )

      expect(first).not.toBe(second)
    })

    it('throws when there are no entity reference anchors', () => {
      expect(() =>
        buildClientActionBaseKey(
          buildInput({
            refs: {
              bookingId: null,
              consultationApprovalId: null,
              clientId: null,
              professionalId: null,
              inviteId: null,
              aftercareId: null,
            },
          }),
        ),
      ).toThrow(
        'clientActions/idempotency: at least one entity reference is required to build idempotency keys.',
      )
    })
  })

  describe('buildClientActionSendKey', () => {
    it('returns the same send key for INITIAL_SEND and RETRY', () => {
      const initial = buildClientActionSendKey(
        buildInput({ resendMode: 'INITIAL_SEND' }),
      )

      const retry = buildClientActionSendKey(
        buildInput({ resendMode: 'RETRY' }),
      )

      expect(initial).toBe(retry)
    })

    it('returns a different send key for RESEND than INITIAL_SEND', () => {
      const initial = buildClientActionSendKey(
        buildInput({ resendMode: 'INITIAL_SEND' }),
      )

      const resend = buildClientActionSendKey(
        buildInput({
          resendMode: 'RESEND',
        }),
      )

      expect(initial).not.toBe(resend)
    })

    it('returns the same resend send key when the resend version is the same', () => {
      const first = buildClientActionSendKey({
        ...buildInput({
          resendMode: 'RESEND',
        }),
        sendVersion: 'manual-resend-1',
      })

      const second = buildClientActionSendKey({
        ...buildInput({
          resendMode: 'RESEND',
        }),
        sendVersion: 'manual-resend-1',
      })

      expect(first).toBe(second)
    })

    it('returns a different resend send key when the resend version changes', () => {
      const first = buildClientActionSendKey({
        ...buildInput({
          resendMode: 'RESEND',
        }),
        sendVersion: 'manual-resend-1',
      })

      const second = buildClientActionSendKey({
        ...buildInput({
          resendMode: 'RESEND',
        }),
        sendVersion: 'manual-resend-2',
      })

      expect(first).not.toBe(second)
    })

    it('uses a stable default resend discriminator when resendVersion is omitted', () => {
      const first = buildClientActionSendKey(
        buildInput({
          resendMode: 'RESEND',
        }),
      )

      const second = buildClientActionSendKey(
        buildInput({
          resendMode: 'RESEND',
        }),
      )

      expect(first).toBe(second)
    })
  })

  describe('buildClientActionIdempotencyKeys', () => {
    it('returns both baseKey and sendKey', () => {
      const result = buildClientActionIdempotencyKeys(buildInput())

      expect(result).toEqual({
        baseKey: buildClientActionBaseKey(buildInput()),
        sendKey: buildClientActionSendKey(buildInput()),
      })
    })

    it('keeps the base key stable while allowing resend send keys to differ', () => {
      const initial = buildClientActionIdempotencyKeys(
        buildInput({
          resendMode: 'INITIAL_SEND',
        }),
      )

      const resend = buildClientActionIdempotencyKeys({
        ...buildInput({
          resendMode: 'RESEND',
        }),
        sendVersion: 'manual-resend-1',
      })

      expect(initial.baseKey).toBe(resend.baseKey)
      expect(initial.sendKey).not.toBe(resend.sendKey)
    })
  })

  describe('listClientActionIdempotencyAnchors', () => {
    it('returns anchors in stable entity-ref order and omits blank values', () => {
      expect(
        listClientActionIdempotencyAnchors({
          inviteId: 'invite_123',
          aftercareId: '   ',
          consultationApprovalId: 'consult_123',
          bookingId: 'booking_123',
          clientId: 'client_123',
          professionalId: 'pro_123',
        }),
      ).toEqual([
        'inviteId:invite_123',
        'consultationApprovalId:consult_123',
        'bookingId:booking_123',
        'clientId:client_123',
        'professionalId:pro_123',
      ])
    })

    it('returns an empty list when there are no usable anchors', () => {
      expect(
        listClientActionIdempotencyAnchors({
          inviteId: null,
          aftercareId: null,
          consultationApprovalId: '   ',
          bookingId: null,
          clientId: null,
          professionalId: undefined,
        }),
      ).toEqual([])
    })
  })
})