// lib/proTrustState.test.ts

import { describe, expect, it } from 'vitest'
import {
  MediaVisibility,
  Role,
  VerificationStatus,
} from '@prisma/client'

import {
  PUBLICLY_APPROVED_PRO_STATUSES,
  canEditPublicPublishingFields,
  canViewerSeeProPublicSurface,
  canViewerSeePublicMediaSurface,
  getPostVerificationNextUrl,
  isPubliclyApprovedProStatus,
} from './proTrustState'

describe('lib/proTrustState', () => {
  describe('PUBLICLY_APPROVED_PRO_STATUSES', () => {
    it('only treats APPROVED as publicly live', () => {
      expect(PUBLICLY_APPROVED_PRO_STATUSES).toEqual([
        VerificationStatus.APPROVED,
      ])
    })
  })

  describe('isPubliclyApprovedProStatus', () => {
    it('returns true for APPROVED', () => {
      expect(isPubliclyApprovedProStatus(VerificationStatus.APPROVED)).toBe(true)
    })

    it('returns false for non-approved statuses and empty values', () => {
      expect(isPubliclyApprovedProStatus(VerificationStatus.PENDING)).toBe(false)
      expect(isPubliclyApprovedProStatus(VerificationStatus.REJECTED)).toBe(false)
      expect(isPubliclyApprovedProStatus(VerificationStatus.NEEDS_INFO)).toBe(false)
      expect(isPubliclyApprovedProStatus(null)).toBe(false)
      expect(isPubliclyApprovedProStatus(undefined)).toBe(false)
    })
  })

  describe('canEditPublicPublishingFields', () => {
    it('allows publishing-field edits only for approved pros', () => {
      expect(
        canEditPublicPublishingFields(VerificationStatus.APPROVED),
      ).toBe(true)

      expect(
        canEditPublicPublishingFields(VerificationStatus.PENDING),
      ).toBe(false)

      expect(
        canEditPublicPublishingFields(VerificationStatus.REJECTED),
      ).toBe(false)

      expect(
        canEditPublicPublishingFields(VerificationStatus.NEEDS_INFO),
      ).toBe(false)

      expect(canEditPublicPublishingFields(null)).toBe(false)
      expect(canEditPublicPublishingFields(undefined)).toBe(false)
    })
  })

  describe('canViewerSeeProPublicSurface', () => {
    const professionalId = 'pro_123'

    it('allows the owner to preview an unapproved public surface', () => {
      expect(
        canViewerSeeProPublicSurface({
          viewerRole: Role.PRO,
          viewerProfessionalId: professionalId,
          professionalId,
          verificationStatus: VerificationStatus.PENDING,
        }),
      ).toBe(true)
    })

    it('blocks non-owners from seeing an unapproved public surface', () => {
      expect(
        canViewerSeeProPublicSurface({
          viewerRole: Role.CLIENT,
          viewerProfessionalId: null,
          professionalId,
          verificationStatus: VerificationStatus.PENDING,
        }),
      ).toBe(false)

      expect(
        canViewerSeeProPublicSurface({
          viewerRole: Role.PRO,
          viewerProfessionalId: 'other_pro',
          professionalId,
          verificationStatus: VerificationStatus.REJECTED,
        }),
      ).toBe(false)
    })

    it('allows non-owners to see an approved public surface', () => {
      expect(
        canViewerSeeProPublicSurface({
          viewerRole: Role.CLIENT,
          viewerProfessionalId: null,
          professionalId,
          verificationStatus: VerificationStatus.APPROVED,
        }),
      ).toBe(true)
    })

    it('does not treat a matching id as owner unless the viewer role is PRO', () => {
      expect(
        canViewerSeeProPublicSurface({
          viewerRole: Role.CLIENT,
          viewerProfessionalId: professionalId,
          professionalId,
          verificationStatus: VerificationStatus.PENDING,
        }),
      ).toBe(false)
    })
  })

  describe('canViewerSeePublicMediaSurface', () => {
    const professionalId = 'pro_123'

    it('allows approved public media for non-owners', () => {
      expect(
        canViewerSeePublicMediaSurface({
          viewerRole: Role.CLIENT,
          viewerProfessionalId: null,
          professionalId,
          verificationStatus: VerificationStatus.APPROVED,
          visibility: MediaVisibility.PUBLIC,
        }),
      ).toBe(true)
    })

    it('blocks non-owners from public media when the pro is not approved', () => {
      expect(
        canViewerSeePublicMediaSurface({
          viewerRole: Role.CLIENT,
          viewerProfessionalId: null,
          professionalId,
          verificationStatus: VerificationStatus.PENDING,
          visibility: MediaVisibility.PUBLIC,
        }),
      ).toBe(false)
    })

    it('allows the owner to preview public media before approval', () => {
      expect(
        canViewerSeePublicMediaSurface({
          viewerRole: Role.PRO,
          viewerProfessionalId: professionalId,
          professionalId,
          verificationStatus: VerificationStatus.PENDING,
          visibility: MediaVisibility.PUBLIC,
        }),
      ).toBe(true)
    })

    it('blocks non-public media even when the pro is approved', () => {
      expect(
        canViewerSeePublicMediaSurface({
          viewerRole: Role.CLIENT,
          viewerProfessionalId: null,
          professionalId,
          verificationStatus: VerificationStatus.APPROVED,
          visibility: MediaVisibility.PRO_CLIENT,
        }),
      ).toBe(false)
    })
  })

  describe('getPostVerificationNextUrl', () => {
    it('routes admins and clients to their existing homes', () => {
      expect(
        getPostVerificationNextUrl({
          role: Role.ADMIN,
          professionalVerificationStatus: null,
        }),
      ).toBe('/admin')

      expect(
        getPostVerificationNextUrl({
          role: Role.CLIENT,
          professionalVerificationStatus: null,
        }),
      ).toBe('/looks')
    })

    it('routes approved pros to the calendar', () => {
      expect(
        getPostVerificationNextUrl({
          role: Role.PRO,
          professionalVerificationStatus: VerificationStatus.APPROVED,
        }),
      ).toBe('/pro/calendar')
    })

    it('routes non-approved pros to the profile setup surface', () => {
      expect(
        getPostVerificationNextUrl({
          role: Role.PRO,
          professionalVerificationStatus: VerificationStatus.PENDING,
        }),
      ).toBe('/pro/profile/public-profile')

      expect(
        getPostVerificationNextUrl({
          role: Role.PRO,
          professionalVerificationStatus: VerificationStatus.REJECTED,
        }),
      ).toBe('/pro/profile/public-profile')

      expect(
        getPostVerificationNextUrl({
          role: Role.PRO,
          professionalVerificationStatus: VerificationStatus.NEEDS_INFO,
        }),
      ).toBe('/pro/profile/public-profile')

      expect(
        getPostVerificationNextUrl({
          role: Role.PRO,
          professionalVerificationStatus: null,
        }),
      ).toBe('/pro/profile/public-profile')

      expect(
        getPostVerificationNextUrl({
          role: Role.PRO,
          professionalVerificationStatus: undefined,
        }),
      ).toBe('/pro/profile/public-profile')
    })
  })
})