// lib/proTrustState.test.ts

import { describe, expect, it } from 'vitest'
import {
  MediaVisibility,
  Role,
  VerificationStatus,
} from '@prisma/client'

import {
  PUBLICLY_LISTABLE_PRO_STATUSES,
  canEditPublicPublishingFields,
  canViewerSeeProPublicSurface,
  canViewerSeePublicMediaSurface,
  getPostVerificationNextUrl,
  canListProPublicly,
  hasVerifiedLicenceBadge,
  isBarredProStatus,
} from './proTrustState'

describe('lib/proTrustState', () => {
  describe('PUBLICLY_LISTABLE_PRO_STATUSES', () => {
    it('lists everyone an admin has not refused', () => {
      // Order follows the declaration in proTrustState, and these feed Prisma
      // `in:` filters across search, discovery, the feed and the sitemap — so
      // this is the one assertion that says who the marketplace can see.
      expect(PUBLICLY_LISTABLE_PRO_STATUSES).toEqual([
        VerificationStatus.PENDING,
        VerificationStatus.PENDING_MANUAL_REVIEW,
        VerificationStatus.APPROVED,
      ])
    })

    it('never lists a refused pro', () => {
      expect(PUBLICLY_LISTABLE_PRO_STATUSES).not.toContain(
        VerificationStatus.REJECTED,
      )
      expect(PUBLICLY_LISTABLE_PRO_STATUSES).not.toContain(
        VerificationStatus.NEEDS_INFO,
      )
    })
  })

  describe('isBarredProStatus', () => {
    it('is true only where an admin actively said no, or is waiting', () => {
      expect(isBarredProStatus(VerificationStatus.REJECTED)).toBe(true)
      expect(isBarredProStatus(VerificationStatus.NEEDS_INFO)).toBe(true)
    })

    it('does not treat "not reviewed yet" as a refusal', () => {
      expect(isBarredProStatus(VerificationStatus.PENDING)).toBe(false)
      expect(isBarredProStatus(VerificationStatus.PENDING_MANUAL_REVIEW)).toBe(
        false,
      )
      expect(isBarredProStatus(VerificationStatus.APPROVED)).toBe(false)
      // No status at all is an absence of review, not a rejection.
      expect(isBarredProStatus(null)).toBe(false)
      expect(isBarredProStatus(undefined)).toBe(false)
    })
  })

  describe('canListProPublicly', () => {
    it('lists an unreviewed pro — the licence is a badge, not a gate', () => {
      expect(canListProPublicly(VerificationStatus.PENDING)).toBe(true)
      expect(canListProPublicly(VerificationStatus.PENDING_MANUAL_REVIEW)).toBe(
        true,
      )
      expect(canListProPublicly(VerificationStatus.APPROVED)).toBe(true)
    })

    it('still refuses a pro an admin refused', () => {
      expect(canListProPublicly(VerificationStatus.REJECTED)).toBe(false)
      expect(canListProPublicly(VerificationStatus.NEEDS_INFO)).toBe(false)
    })

    it('has nothing to list without a status', () => {
      // Unlike isBarredProStatus, a missing status here means "no professional
      // profile", and there is no such pro to put on a page.
      expect(canListProPublicly(null)).toBe(false)
      expect(canListProPublicly(undefined)).toBe(false)
    })
  })

  describe('hasVerifiedLicenceBadge', () => {
    it('is APPROVED and nothing else', () => {
      // The whole visible difference between a reviewed and an unreviewed pro,
      // and the hook v2's products/classes are meant to gate on. If this ever
      // starts returning true for PENDING, the badge stops meaning anything.
      expect(hasVerifiedLicenceBadge(VerificationStatus.APPROVED)).toBe(true)

      for (const status of [
        VerificationStatus.PENDING,
        VerificationStatus.PENDING_MANUAL_REVIEW,
        VerificationStatus.REJECTED,
        VerificationStatus.NEEDS_INFO,
      ]) {
        expect(hasVerifiedLicenceBadge(status)).toBe(false)
      }

      expect(hasVerifiedLicenceBadge(null)).toBe(false)
      expect(hasVerifiedLicenceBadge(undefined)).toBe(false)
    })

    it('is a strictly narrower question than being listed', () => {
      // The pair that must never collapse into one: an unreviewed pro is
      // listed WITHOUT the badge. That gap is the entire design.
      expect(canListProPublicly(VerificationStatus.PENDING)).toBe(true)
      expect(hasVerifiedLicenceBadge(VerificationStatus.PENDING)).toBe(false)
    })
  })

  describe('canEditPublicPublishingFields', () => {
    it('lets any pro who can be listed edit what is published', () => {
      expect(canEditPublicPublishingFields(VerificationStatus.APPROVED)).toBe(
        true,
      )
      expect(canEditPublicPublishingFields(VerificationStatus.PENDING)).toBe(
        true,
      )
    })

    it('does not let a refused pro publish', () => {
      expect(canEditPublicPublishingFields(VerificationStatus.REJECTED)).toBe(
        false,
      )
      expect(canEditPublicPublishingFields(VerificationStatus.NEEDS_INFO)).toBe(
        false,
      )
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

    it('shows an unreviewed pro to everyone, not just its owner', () => {
      expect(
        canViewerSeeProPublicSurface({
          viewerRole: Role.CLIENT,
          viewerProfessionalId: null,
          professionalId,
          verificationStatus: VerificationStatus.PENDING,
        }),
      ).toBe(true)
    })

    it('still hides a refused pro from everyone but its owner', () => {
      expect(
        canViewerSeeProPublicSurface({
          viewerRole: Role.PRO,
          viewerProfessionalId: 'other_pro',
          professionalId,
          verificationStatus: VerificationStatus.REJECTED,
        }),
      ).toBe(false)

      expect(
        canViewerSeeProPublicSurface({
          viewerRole: Role.CLIENT,
          viewerProfessionalId: null,
          professionalId,
          verificationStatus: VerificationStatus.NEEDS_INFO,
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
      // REJECTED rather than PENDING: an unreviewed pro is visible to everyone
      // now, so PENDING could no longer tell the owner branch from the public
      // one — the assertion would have passed without exercising anything.
      expect(
        canViewerSeeProPublicSurface({
          viewerRole: Role.CLIENT,
          viewerProfessionalId: professionalId,
          professionalId,
          verificationStatus: VerificationStatus.REJECTED,
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

    it('shows an unreviewed pro\u2019s public media to non-owners', () => {
      expect(
        canViewerSeePublicMediaSurface({
          viewerRole: Role.CLIENT,
          viewerProfessionalId: null,
          professionalId,
          verificationStatus: VerificationStatus.PENDING,
          visibility: MediaVisibility.PUBLIC,
        }),
      ).toBe(true)
    })

    it('blocks non-owners from a refused pro\u2019s public media', () => {
      expect(
        canViewerSeePublicMediaSurface({
          viewerRole: Role.CLIENT,
          viewerProfessionalId: null,
          professionalId,
          verificationStatus: VerificationStatus.REJECTED,
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