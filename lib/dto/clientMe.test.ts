// lib/dto/clientMe.test.ts
//
// Drives the REAL serializer (no vi.mock of serializeClientMePageData — the
// route test at app/api/v1/me/route.test.ts mocks it wholesale, so it cannot
// see what this payload actually carries).
//
// What matters here is `user.availableWorkspaces`: it is the ONLY signal native
// has for "may this account switch to the pro shell?". The acting `role` is
// always CLIENT on this endpoint and the session JWT carries only that acting
// role, so without this field a dual-role pro browsing as a client is
// indistinguishable on the wire from a client-only account.
import { VerificationStatus, type Role } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { serializeClientMePageData } from '@/lib/dto/clientMe'
import type { ClientMePageData } from '@/app/client/(gated)/me/_data/loadClientMePage'

const CREATED_AT = new Date('2026-01-02T03:04:05.000Z')

/**
 * A client-acting user with the capability inputs under test. Everything else
 * is the minimum the serializer reads — this is a real `ClientMePageData`, not
 * a cast.
 */
function makePageData(args: {
  homeRole: Role
  professionalProfile?: { verificationStatus: VerificationStatus } | null
  canAccessAdmin?: boolean
}): ClientMePageData {
  const clientProfile = {
    id: 'client_1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    avatarUrl: null,
    phoneVerifiedAt: null,
  }

  return {
    user: {
      id: 'user_1',
      email: 'ada@example.com',
      phone: null,
      authVersion: 1,
      createdAt: CREATED_AT,
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
      clientProfile,
      professionalProfile:
        args.professionalProfile === undefined
          ? null
          : args.professionalProfile === null
            ? null
            : {
                id: 'pro_1',
                businessName: 'Studio',
                firstName: 'Ada',
                lastName: 'Lovelace',
                handle: 'ada',
                nameDisplay: 'BUSINESS_NAME',
                avatarUrl: null,
                timeZone: 'America/Los_Angeles',
                location: 'Portland, OR',
                phoneVerifiedAt: null,
                verificationStatus: args.professionalProfile.verificationStatus,
              },
      // The ACTING role — always CLIENT for this payload (requireClient-gated).
      role: 'CLIENT',
      homeRole: args.homeRole,
      canAccessAdmin: args.canAccessAdmin ?? false,
      sessionKind: 'ACTIVE',
      isPhoneVerified: true,
      isEmailVerified: true,
      isFullyVerified: true,
      deviceId: null,
    },
    profile: {
      id: 'client_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      avatarUrl: null,
      claimStatus: 'CLAIMED',
      claimedAt: null,
      handle: 'ada',
      isPublicProfile: false,
    },
    boards: [],
    following: {
      clientId: 'client_1',
      items: [],
      pagination: { take: 24, skip: 0, hasMore: false },
    },
    counts: { boards: 0, saved: 0, booked: 0, following: 0, followers: 0 },
    upcomingNotificationBooking: null,
    history: [],
    myLooks: [],
    activityUnreadCount: 0,
    creator: {
      isCreator: false,
      savesOnYourLooks: 0,
      bookedFromYou: 0,
      remixes: [],
    },
  }
}

describe('serializeClientMePageData — availableWorkspaces', () => {
  it('offers PRO to a dual-role account browsing as a client (the trap case)', () => {
    // A pro who switched into the client shell. Acting role is CLIENT, so the
    // ONLY thing that can put them back is this field.
    const dto = serializeClientMePageData(
      makePageData({
        homeRole: 'PRO',
        professionalProfile: {
          verificationStatus: VerificationStatus.APPROVED,
        },
      }),
    )

    expect(dto.user.role).toBe('CLIENT')
    expect(dto.user.availableWorkspaces).toEqual(['PRO', 'CLIENT'])
  })

  it('offers only CLIENT to a client-only account', () => {
    const dto = serializeClientMePageData(makePageData({ homeRole: 'CLIENT' }))

    expect(dto.user.availableWorkspaces).toEqual(['CLIENT'])
    expect(dto.user.availableWorkspaces).not.toContain('PRO')
  })

  it('withholds PRO while the professional profile is not APPROVED', () => {
    // The entitlement boundary: a pending/rejected pro would get a 403 from
    // POST /workspace/switch, so the row must not be offered. Anything other
    // than APPROVED is not entitled.
    for (const status of [
      VerificationStatus.PENDING,
      VerificationStatus.REJECTED,
    ]) {
      const dto = serializeClientMePageData(
        makePageData({
          homeRole: 'PRO',
          professionalProfile: { verificationStatus: status },
        }),
      )

      expect(dto.user.availableWorkspaces).toEqual(['CLIENT'])
    }
  })

  it('offers ADMIN on a super-admin grant, in switcher display order', () => {
    const dto = serializeClientMePageData(
      makePageData({
        homeRole: 'PRO',
        professionalProfile: {
          verificationStatus: VerificationStatus.APPROVED,
        },
        canAccessAdmin: true,
      }),
    )

    expect(dto.user.availableWorkspaces).toEqual(['ADMIN', 'PRO', 'CLIENT'])
  })

  it('always includes CLIENT — the field is never empty', () => {
    // A length of 1 is how the client tells "no switch to offer" from a
    // missing/old server that omits the field entirely.
    for (const homeRole of ['CLIENT', 'PRO', 'ADMIN'] as const) {
      const dto = serializeClientMePageData(makePageData({ homeRole }))
      expect(dto.user.availableWorkspaces).toContain('CLIENT')
    }
  })
})
