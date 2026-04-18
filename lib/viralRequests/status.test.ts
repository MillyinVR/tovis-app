// lib/viralRequests/status.test.ts
import { describe, expect, it } from 'vitest'
import { ViralServiceRequestStatus } from '@prisma/client'

import {
  canTransitionViralRequestStatus,
  getViralRequestStatusLabel,
  getViralRequestStatusTone,
} from './status'

describe('lib/viralRequests/status.ts', () => {
  describe('getViralRequestStatusLabel', () => {
    it('returns Requested for REQUESTED', () => {
      expect(
        getViralRequestStatusLabel(ViralServiceRequestStatus.REQUESTED),
      ).toBe('Requested')
    })

    it('returns In review for IN_REVIEW', () => {
      expect(
        getViralRequestStatusLabel(ViralServiceRequestStatus.IN_REVIEW),
      ).toBe('In review')
    })

    it('returns Approved for APPROVED', () => {
      expect(
        getViralRequestStatusLabel(ViralServiceRequestStatus.APPROVED),
      ).toBe('Approved')
    })

    it('returns Denied for REJECTED', () => {
      expect(
        getViralRequestStatusLabel(ViralServiceRequestStatus.REJECTED),
      ).toBe('Denied')
    })
  })

  describe('getViralRequestStatusTone', () => {
    it('returns warn tone for REQUESTED', () => {
      expect(
        getViralRequestStatusTone(ViralServiceRequestStatus.REQUESTED),
      ).toBe('text-toneWarn')
    })

    it('returns accent tone for IN_REVIEW', () => {
      expect(
        getViralRequestStatusTone(ViralServiceRequestStatus.IN_REVIEW),
      ).toBe('text-accentPrimary')
    })

    it('returns success tone for APPROVED', () => {
      expect(
        getViralRequestStatusTone(ViralServiceRequestStatus.APPROVED),
      ).toBe('text-toneSuccess')
    })

    it('returns danger tone for REJECTED', () => {
      expect(
        getViralRequestStatusTone(ViralServiceRequestStatus.REJECTED),
      ).toBe('text-toneDanger')
    })
  })

  describe('canTransitionViralRequestStatus', () => {
    it('allows same-status transitions', () => {
      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.REQUESTED,
          ViralServiceRequestStatus.REQUESTED,
        ),
      ).toBe(true)

      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.IN_REVIEW,
          ViralServiceRequestStatus.IN_REVIEW,
        ),
      ).toBe(true)

      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.APPROVED,
          ViralServiceRequestStatus.APPROVED,
        ),
      ).toBe(true)

      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.REJECTED,
          ViralServiceRequestStatus.REJECTED,
        ),
      ).toBe(true)
    })

    it('allows REQUESTED to move to IN_REVIEW, APPROVED, or REJECTED', () => {
      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.REQUESTED,
          ViralServiceRequestStatus.IN_REVIEW,
        ),
      ).toBe(true)

      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.REQUESTED,
          ViralServiceRequestStatus.APPROVED,
        ),
      ).toBe(true)

      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.REQUESTED,
          ViralServiceRequestStatus.REJECTED,
        ),
      ).toBe(true)
    })

    it('allows IN_REVIEW to move to APPROVED or REJECTED', () => {
      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.IN_REVIEW,
          ViralServiceRequestStatus.APPROVED,
        ),
      ).toBe(true)

      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.IN_REVIEW,
          ViralServiceRequestStatus.REJECTED,
        ),
      ).toBe(true)
    })

    it('blocks IN_REVIEW from moving back to REQUESTED', () => {
      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.IN_REVIEW,
          ViralServiceRequestStatus.REQUESTED,
        ),
      ).toBe(false)
    })

    it('blocks APPROVED from moving to another terminal status', () => {
      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.APPROVED,
          ViralServiceRequestStatus.REQUESTED,
        ),
      ).toBe(false)

      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.APPROVED,
          ViralServiceRequestStatus.IN_REVIEW,
        ),
      ).toBe(false)

      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.APPROVED,
          ViralServiceRequestStatus.REJECTED,
        ),
      ).toBe(false)
    })

    it('blocks REJECTED from moving to another terminal status', () => {
      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.REJECTED,
          ViralServiceRequestStatus.REQUESTED,
        ),
      ).toBe(false)

      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.REJECTED,
          ViralServiceRequestStatus.IN_REVIEW,
        ),
      ).toBe(false)

      expect(
        canTransitionViralRequestStatus(
          ViralServiceRequestStatus.REJECTED,
          ViralServiceRequestStatus.APPROVED,
        ),
      ).toBe(false)
    })
  })
})