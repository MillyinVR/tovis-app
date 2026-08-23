// lib/clients/claimAdoption.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientClaimStatus,
  ContactMethod,
  ProClientInviteStatus,
} from '@prisma/client'

const TEST_NOW = new Date('2026-04-12T12:00:00.000Z')

const MATCHING_EMAIL = 'tori@example.com'
const MATCHING_PHONE = '+16195551234'

const mocks = vi.hoisted(() => {
  const tx = {
    clientProfile: {
      updateMany: vi.fn(),
    },
  }

  return {
    tx,
    getClientClaimLinkByToken: vi.fn(),
    markClientClaimLinkAcceptedAudit: vi.fn(),
    markUserEmailVerified: vi.fn(),
    markUserPhoneVerified: vi.fn(),
  }
})

vi.mock('./clientClaimLinks', () => ({
  getClientClaimLinkByToken: mocks.getClientClaimLinkByToken,
  markClientClaimLinkAcceptedAudit: mocks.markClientClaimLinkAcceptedAudit,
}))
vi.mock('@/lib/auth/contactVerification', () => ({
  markUserEmailVerified: mocks.markUserEmailVerified,
  markUserPhoneVerified: mocks.markUserPhoneVerified,
}))

import { adoptClaimInviteDuringRegistration } from './claimAdoption'

function makeInvite(overrides?: {
  id?: string
  invitedEmail?: string | null
  invitedPhone?: string | null
  status?: ProClientInviteStatus
  revokedAt?: Date | null
  acceptedAt?: Date | null
  preferredContactMethod?: ContactMethod | null
  client?: {
    id?: string
    userId?: string | null
    claimStatus?: ClientClaimStatus
    preferredContactMethod?: ContactMethod | null
  } | null
}) {
  return {
    id: overrides?.id ?? 'invite_1',
    clientId: overrides?.client?.id ?? 'client_1',
    invitedEmail:
      overrides?.invitedEmail !== undefined
        ? overrides.invitedEmail
        : MATCHING_EMAIL,
    invitedPhone:
      overrides?.invitedPhone !== undefined ? overrides.invitedPhone : null,
    preferredContactMethod:
      overrides?.preferredContactMethod !== undefined
        ? overrides.preferredContactMethod
        : ContactMethod.EMAIL,
    status: overrides?.status ?? ProClientInviteStatus.PENDING,
    acceptedAt:
      overrides?.acceptedAt !== undefined ? overrides.acceptedAt : null,
    revokedAt: overrides?.revokedAt !== undefined ? overrides.revokedAt : null,
    client:
      overrides?.client !== undefined
        ? overrides.client
        : {
            id: 'client_1',
            userId: null,
            claimStatus: ClientClaimStatus.UNCLAIMED,
            preferredContactMethod: null,
          },
  }
}

function callAdopt(overrides?: {
  token?: string | null
  registeredEmail?: string | null
  registeredPhone?: string | null
  verifiedChannel?: ContactMethod | null
}) {
  return adoptClaimInviteDuringRegistration({
    tx: mocks.tx as never,
    token: overrides?.token !== undefined ? overrides.token : 'token_1',
    userId: 'user_1',
    registeredEmail:
      overrides?.registeredEmail !== undefined
        ? overrides.registeredEmail
        : MATCHING_EMAIL,
    registeredPhone:
      overrides?.registeredPhone !== undefined
        ? overrides.registeredPhone
        : null,
    verifiedChannel: overrides?.verifiedChannel ?? null,
    now: TEST_NOW,
  })
}

describe('adoptClaimInviteDuringRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getClientClaimLinkByToken.mockResolvedValue(makeInvite())
    mocks.tx.clientProfile.updateMany.mockResolvedValue({ count: 1 })
    mocks.markClientClaimLinkAcceptedAudit.mockResolvedValue('ok')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns no_token when the token is blank', async () => {
    const result = await callAdopt({ token: '   ' })

    expect(result).toEqual({ adopted: false, reason: 'no_token' })
    expect(mocks.getClientClaimLinkByToken).not.toHaveBeenCalled()
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
  })

  it('returns no_token when the token is null', async () => {
    const result = await callAdopt({ token: null })

    expect(result).toEqual({ adopted: false, reason: 'no_token' })
    expect(mocks.getClientClaimLinkByToken).not.toHaveBeenCalled()
  })

  it('returns not_found when the invite does not exist', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(null)

    const result = await callAdopt()

    expect(result).toEqual({ adopted: false, reason: 'not_found' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
  })

  it('returns not_found when the invite has no linked client', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({ client: null }),
    )

    const result = await callAdopt()

    expect(result).toEqual({ adopted: false, reason: 'not_found' })
  })

  it('returns revoked when the invite status is REVOKED', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({ status: ProClientInviteStatus.REVOKED }),
    )

    const result = await callAdopt()

    expect(result).toEqual({ adopted: false, reason: 'revoked' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
  })

  it('returns revoked when revokedAt is set even if still PENDING', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({ revokedAt: new Date('2026-04-12T11:00:00.000Z') }),
    )

    const result = await callAdopt()

    expect(result).toEqual({ adopted: false, reason: 'revoked' })
  })

  it('returns already_claimed when the client already has a user', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_1',
          userId: 'user_other',
          claimStatus: ClientClaimStatus.UNCLAIMED,
          preferredContactMethod: null,
        },
      }),
    )

    const result = await callAdopt()

    expect(result).toEqual({ adopted: false, reason: 'already_claimed' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
  })

  it('returns already_claimed when the client claimStatus is CLAIMED', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_1',
          userId: null,
          claimStatus: ClientClaimStatus.CLAIMED,
          preferredContactMethod: null,
        },
      }),
    )

    const result = await callAdopt()

    expect(result).toEqual({ adopted: false, reason: 'already_claimed' })
  })

  it('returns contact_mismatch when neither email nor phone matches', async () => {
    const result = await callAdopt({
      registeredEmail: 'someone-else@example.com',
      registeredPhone: '+15550009999',
    })

    expect(result).toEqual({ adopted: false, reason: 'contact_mismatch' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
  })

  it('adopts the profile when the email matches, writing preferredContactMethod', async () => {
    const result = await callAdopt({ registeredEmail: MATCHING_EMAIL })

    expect(mocks.tx.clientProfile.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'client_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      },
      data: {
        userId: 'user_1',
        claimStatus: ClientClaimStatus.CLAIMED,
        claimedAt: TEST_NOW,
        preferredContactMethod: ContactMethod.EMAIL,
      },
    })

    expect(mocks.markClientClaimLinkAcceptedAudit).toHaveBeenCalledWith({
      inviteId: 'invite_1',
      actingUserId: 'user_1',
      acceptedAt: TEST_NOW,
      tx: mocks.tx,
    })

    expect(result).toEqual({
      adopted: true,
      clientId: 'client_1',
      verifiedChannelApplied: null,
    })
  })

  it('adopts the profile when only the phone matches', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({ invitedEmail: null, invitedPhone: MATCHING_PHONE }),
    )

    const result = await callAdopt({
      registeredEmail: 'different@example.com',
      registeredPhone: MATCHING_PHONE,
    })

    expect(result).toEqual({
      adopted: true,
      clientId: 'client_1',
      verifiedChannelApplied: null,
    })
    expect(mocks.tx.clientProfile.updateMany).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite an existing preferredContactMethod', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        preferredContactMethod: ContactMethod.EMAIL,
        client: {
          id: 'client_1',
          userId: null,
          claimStatus: ClientClaimStatus.UNCLAIMED,
          preferredContactMethod: ContactMethod.SMS,
        },
      }),
    )

    await callAdopt()

    expect(mocks.tx.clientProfile.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'client_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      },
      data: {
        userId: 'user_1',
        claimStatus: ClientClaimStatus.CLAIMED,
        claimedAt: TEST_NOW,
      },
    })
  })

  it('does not write preferredContactMethod when the invite has none', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({ preferredContactMethod: null }),
    )

    await callAdopt()

    expect(mocks.tx.clientProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 'user_1',
          claimStatus: ClientClaimStatus.CLAIMED,
          claimedAt: TEST_NOW,
        },
      }),
    )
  })

  it('preserves an existing invite acceptedAt for the audit', async () => {
    const acceptedAt = new Date('2026-04-12T11:00:00.000Z')
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({ acceptedAt }),
    )

    await callAdopt()

    expect(mocks.markClientClaimLinkAcceptedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ acceptedAt }),
    )
  })

  it('credits the claim-click channel as verified when its contact matches', async () => {
    const result = await callAdopt({
      registeredEmail: MATCHING_EMAIL,
      verifiedChannel: ContactMethod.EMAIL,
    })

    expect(result).toEqual({
      adopted: true,
      clientId: 'client_1',
      verifiedChannelApplied: ContactMethod.EMAIL,
    })
    expect(mocks.markUserEmailVerified).toHaveBeenCalledWith(mocks.tx, {
      userId: 'user_1',
      verifiedAt: TEST_NOW,
    })
    expect(mocks.markUserPhoneVerified).not.toHaveBeenCalled()
  })

  it('credits an SMS click against the matching registered phone', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({ invitedEmail: null, invitedPhone: MATCHING_PHONE }),
    )

    const result = await callAdopt({
      registeredEmail: 'different@example.com',
      registeredPhone: MATCHING_PHONE,
      verifiedChannel: ContactMethod.SMS,
    })

    expect(result).toEqual({
      adopted: true,
      clientId: 'client_1',
      verifiedChannelApplied: ContactMethod.SMS,
    })
    expect(mocks.markUserPhoneVerified).toHaveBeenCalledWith(mocks.tx, {
      userId: 'user_1',
      role: 'CLIENT',
      verifiedAt: TEST_NOW,
    })
    expect(mocks.markUserEmailVerified).not.toHaveBeenCalled()
  })

  it('gives NO channel credit when the click channel contact is not the registered one', async () => {
    // Adoption matched on phone, but the click came from the email channel —
    // the registered email differs from the invite's, so no email credit.
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({ invitedEmail: MATCHING_EMAIL, invitedPhone: MATCHING_PHONE }),
    )

    const result = await callAdopt({
      registeredEmail: 'different@example.com',
      registeredPhone: MATCHING_PHONE,
      verifiedChannel: ContactMethod.EMAIL,
    })

    expect(result).toEqual({
      adopted: true,
      clientId: 'client_1',
      verifiedChannelApplied: null,
    })
    expect(mocks.markUserEmailVerified).not.toHaveBeenCalled()
    expect(mocks.markUserPhoneVerified).not.toHaveBeenCalled()
  })

  it('returns lost_race when the guarded claim update matches no rows', async () => {
    mocks.tx.clientProfile.updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await callAdopt()

    expect(result).toEqual({ adopted: false, reason: 'lost_race' })
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })
})
