// lib/looks/guards.test.ts
import { describe, expect, it } from 'vitest'
import {
  MediaVisibility,
  Role,
  VerificationStatus,
} from '@prisma/client'

import {
  canCommentOnLookPost,
  canEditLookPost,
  canModerateLookPost,
  canSaveLookPost,
  canViewLookPost,
  isPublicLooksEligibleMedia,
} from './guards'

describe('lib/looks/guards.ts', () => {
  describe('isPublicLooksEligibleMedia', () => {
    it('returns true for PUBLIC media that is eligible for looks', () => {
      expect(
        isPublicLooksEligibleMedia({
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
        }),
      ).toBe(true)
    })

    it('returns true for PUBLIC media featured in portfolio', () => {
      expect(
        isPublicLooksEligibleMedia({
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: false,
          isFeaturedInPortfolio: true,
        }),
      ).toBe(true)
    })

    it('returns false for non-PUBLIC media even if it is looks-eligible', () => {
      expect(
        isPublicLooksEligibleMedia({
          visibility: MediaVisibility.PRO_CLIENT,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: true,
        }),
      ).toBe(false)
    })

    it('returns false for PUBLIC media that is neither looks-eligible nor portfolio-featured', () => {
      expect(
        isPublicLooksEligibleMedia({
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: false,
          isFeaturedInPortfolio: false,
        }),
      ).toBe(false)
    })
  })

  describe('canViewLookPost', () => {
    it('allows the owner to view regardless of public eligibility', () => {
      expect(
        canViewLookPost({
          isOwner: true,
          visibility: MediaVisibility.PRO_CLIENT,
          isEligibleForLooks: false,
          isFeaturedInPortfolio: false,
          proVerificationStatus: VerificationStatus.PENDING,
        }),
      ).toBe(true)
    })

    it('allows non-owner view for PUBLIC looks-eligible media from an approved pro', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          proVerificationStatus: VerificationStatus.APPROVED,
        }),
      ).toBe(true)
    })

    it('allows non-owner view for PUBLIC portfolio-featured media from an approved pro', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: false,
          isFeaturedInPortfolio: true,
          proVerificationStatus: VerificationStatus.APPROVED,
        }),
      ).toBe(true)
    })

    it('blocks non-owner view when the media is not public-eligible', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: false,
          isFeaturedInPortfolio: false,
          proVerificationStatus: VerificationStatus.APPROVED,
        }),
      ).toBe(false)
    })

    it('blocks non-owner view when the pro is not publicly approved', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          proVerificationStatus: VerificationStatus.PENDING,
        }),
      ).toBe(false)
    })

    it('blocks non-owner view when verification status is missing', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          proVerificationStatus: null,
        }),
      ).toBe(false)
    })
  })

  describe('canEditLookPost', () => {
    it('allows only the owner to edit', () => {
      expect(canEditLookPost({ isOwner: true })).toBe(true)
      expect(canEditLookPost({ isOwner: false })).toBe(false)
    })
  })

  describe('canCommentOnLookPost', () => {
    it('matches the view policy for an approved public look', () => {
      expect(
        canCommentOnLookPost({
          isOwner: false,
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          proVerificationStatus: VerificationStatus.APPROVED,
        }),
      ).toBe(true)
    })

    it('blocks comments when the look cannot be viewed', () => {
      expect(
        canCommentOnLookPost({
          isOwner: false,
          visibility: MediaVisibility.PRO_CLIENT,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          proVerificationStatus: VerificationStatus.APPROVED,
        }),
      ).toBe(false)
    })
  })

  describe('canSaveLookPost', () => {
    it('matches the view policy for an approved public look', () => {
      expect(
        canSaveLookPost({
          isOwner: false,
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: false,
          isFeaturedInPortfolio: true,
          proVerificationStatus: VerificationStatus.APPROVED,
        }),
      ).toBe(true)
    })

    it('blocks saves when the look cannot be viewed', () => {
      expect(
        canSaveLookPost({
          isOwner: false,
          visibility: MediaVisibility.PUBLIC,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: false,
          proVerificationStatus: VerificationStatus.REJECTED,
        }),
      ).toBe(false)
    })
  })

  describe('canModerateLookPost', () => {
    it('allows admins to moderate', () => {
      expect(
        canModerateLookPost({
          viewerRole: Role.ADMIN,
        }),
      ).toBe(true)
    })

    it('blocks non-admin roles from moderating', () => {
      expect(
        canModerateLookPost({
          viewerRole: Role.CLIENT,
        }),
      ).toBe(false)

      expect(
        canModerateLookPost({
          viewerRole: Role.PRO,
        }),
      ).toBe(false)

      expect(
        canModerateLookPost({
          viewerRole: null,
        }),
      ).toBe(false)
    })
  })
})