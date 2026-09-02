// lib/looks/guards.test.ts
import { describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Role,
  VerificationStatus,
} from '@prisma/client'

import {
  canCommentOnLookPost,
  canEditLookPost,
  canModerateLookPost,
  canSaveLookPost,
  canViewLookPost,
} from './guards'

describe('lib/looks/guards.ts', () => {
  describe('canViewLookPost', () => {
    it('allows the owner to view regardless of look status or moderation state', () => {
      expect(
        canViewLookPost({
          isOwner: true,
          viewerRole: Role.PRO,
          status: LookPostStatus.REMOVED,
          visibility: LookPostVisibility.FOLLOWERS_ONLY,
          moderationStatus: ModerationStatus.REJECTED,
          proVerificationStatus: VerificationStatus.PENDING,
          viewerFollowsProfessional: false,
        }),
      ).toBe(true)
    })

    it('allows admins to view regardless of look status or moderation state', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          viewerRole: Role.ADMIN,
          status: LookPostStatus.DRAFT,
          visibility: LookPostVisibility.FOLLOWERS_ONLY,
          moderationStatus: ModerationStatus.REMOVED,
          proVerificationStatus: VerificationStatus.PENDING,
          viewerFollowsProfessional: false,
        }),
      ).toBe(true)
    })

    it('allows non-owner view for an approved published PUBLIC look from an approved pro', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          viewerRole: Role.CLIENT,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.APPROVED,
          viewerFollowsProfessional: false,
        }),
      ).toBe(true)
    })

    it('allows non-owner view for FOLLOWERS_ONLY when the viewer follows the pro', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          viewerRole: Role.CLIENT,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.FOLLOWERS_ONLY,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.APPROVED,
          viewerFollowsProfessional: true,
        }),
      ).toBe(true)
    })

    it('blocks non-owner view for FOLLOWERS_ONLY when the viewer does not follow the pro', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          viewerRole: Role.CLIENT,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.FOLLOWERS_ONLY,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.APPROVED,
          viewerFollowsProfessional: false,
        }),
      ).toBe(false)
    })

    it('allows non-owner view for UNLISTED when published and approved', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          viewerRole: Role.CLIENT,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.UNLISTED,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.APPROVED,
          viewerFollowsProfessional: false,
        }),
      ).toBe(true)
    })

    it('blocks non-owner view when the look is not published', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          viewerRole: Role.CLIENT,
          status: LookPostStatus.DRAFT,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.APPROVED,
          viewerFollowsProfessional: false,
        }),
      ).toBe(false)
    })

    it('blocks non-owner view when moderation is not approved', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          viewerRole: Role.CLIENT,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.REJECTED,
          proVerificationStatus: VerificationStatus.APPROVED,
          viewerFollowsProfessional: false,
        }),
      ).toBe(false)
    })

    it('shows an unreviewed pro\u2019s published look to non-owners', () => {
      // The licence is a badge, not a gate (lib/proTrustState.ts). Moderation
      // still governs the POST — the assertion above this one pins that — and
      // this only changes who the pro has to be.
      expect(
        canViewLookPost({
          isOwner: false,
          viewerRole: Role.CLIENT,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.PENDING,
          viewerFollowsProfessional: false,
        }),
      ).toBe(true)
    })

    it('blocks non-owner view when the pro was refused', () => {
      for (const status of [
        VerificationStatus.REJECTED,
        VerificationStatus.NEEDS_INFO,
      ]) {
        expect(
          canViewLookPost({
            isOwner: false,
            viewerRole: Role.CLIENT,
            status: LookPostStatus.PUBLISHED,
            visibility: LookPostVisibility.PUBLIC,
            moderationStatus: ModerationStatus.APPROVED,
            proVerificationStatus: status,
            viewerFollowsProfessional: false,
          }),
        ).toBe(false)
      }
    })

    it('blocks non-owner view when verification status is missing', () => {
      expect(
        canViewLookPost({
          isOwner: false,
          viewerRole: Role.CLIENT,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: null,
          viewerFollowsProfessional: false,
        }),
      ).toBe(false)
    })
  })

  describe('canEditLookPost', () => {
    it('allows only the owner to edit', () => {
      expect(
        canEditLookPost({
          isOwner: true,
          viewerRole: Role.PRO,
        }),
      ).toBe(true)

      expect(
        canEditLookPost({
          isOwner: false,
          viewerRole: Role.ADMIN,
        }),
      ).toBe(false)
    })
  })

  describe('canCommentOnLookPost', () => {
    it('allows comments for a visible approved published public look', () => {
      expect(
        canCommentOnLookPost({
          isOwner: false,
          viewerRole: Role.CLIENT,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.APPROVED,
          viewerFollowsProfessional: false,
        }),
      ).toBe(true)
    })

    it('blocks comments when the look cannot be viewed', () => {
      expect(
        canCommentOnLookPost({
          isOwner: false,
          viewerRole: Role.CLIENT,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.FOLLOWERS_ONLY,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.APPROVED,
          viewerFollowsProfessional: false,
        }),
      ).toBe(false)
    })

    it('blocks comments for admins even when they can view', () => {
      expect(
        canCommentOnLookPost({
          isOwner: false,
          viewerRole: Role.ADMIN,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.APPROVED,
          viewerFollowsProfessional: false,
        }),
      ).toBe(false)
    })

    it('blocks comments for owners on unpublished looks', () => {
      expect(
        canCommentOnLookPost({
          isOwner: true,
          viewerRole: Role.PRO,
          status: LookPostStatus.DRAFT,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.APPROVED,
          viewerFollowsProfessional: false,
        }),
      ).toBe(false)
    })
  })

  describe('canSaveLookPost', () => {
    it('allows saves for a visible approved published followers-only look when following', () => {
      expect(
        canSaveLookPost({
          isOwner: false,
          viewerRole: Role.CLIENT,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.FOLLOWERS_ONLY,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.APPROVED,
          viewerFollowsProfessional: true,
        }),
      ).toBe(true)
    })

    it('blocks saves when the look cannot be viewed', () => {
      expect(
        canSaveLookPost({
          isOwner: false,
          viewerRole: Role.CLIENT,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.REJECTED,
          viewerFollowsProfessional: false,
        }),
      ).toBe(false)
    })

    it('blocks saves for admins even when they can view', () => {
      expect(
        canSaveLookPost({
          isOwner: false,
          viewerRole: Role.ADMIN,
          status: LookPostStatus.PUBLISHED,
          visibility: LookPostVisibility.PUBLIC,
          moderationStatus: ModerationStatus.APPROVED,
          proVerificationStatus: VerificationStatus.APPROVED,
          viewerFollowsProfessional: false,
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