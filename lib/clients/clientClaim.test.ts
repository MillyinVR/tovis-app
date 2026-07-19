// lib/clients/clientClaim.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientClaimStatus,
  ContactMethod,
  ProClientInviteStatus,
} from '@prisma/client'

const TEST_NOW = new Date('2026-04-12T12:00:00.000Z')

const mocks = vi.hoisted(() => {
  const tx = {
    clientProfile: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  }

  return {
    prisma: {
      $transaction: vi.fn(),
    },
    tx,
    getClientClaimLinkByToken: vi.fn(),
    markClientClaimLinkAcceptedAudit: vi.fn(),
    mergeUnclaimedClientProfile: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('./clientClaimLinks', () => ({
  getClientClaimLinkByToken: mocks.getClientClaimLinkByToken,
  markClientClaimLinkAcceptedAudit: mocks.markClientClaimLinkAcceptedAudit,
}))

/**
 * The merge itself is covered against REAL Postgres in
 * tests/integration/claim-merge-unclaimed-profile.test.ts, and the wiring here is
 * covered end-to-end in tests/integration/claim-accept-merge.test.ts. These mocked
 * tests are only about which branch this function picks — a mocked `tx` cannot see
 * a constraint, a Cascade, or a rollback, so nothing here should be read as proof
 * that the merge works.
 */
vi.mock('./mergeUnclaimedClientProfile', () => ({
  mergeUnclaimedClientProfile: mocks.mergeUnclaimedClientProfile,
}))

import { acceptClientClaimFromLink } from './clientClaim'

function makeInvite(overrides?: {
  id?: string
  bookingId?: string
  clientId?: string
  status?: ProClientInviteStatus
  acceptedAt?: Date | null
  revokedAt?: Date | null
  preferredContactMethod?: ContactMethod | null
  client?: {
    id?: string
    userId?: string | null
    claimStatus?: ClientClaimStatus
    claimedAt?: Date | null
    preferredContactMethod?: ContactMethod | null
  } | null
}) {
  return {
    id: overrides?.id ?? 'invite_1',
    token: 'token_1',
    professionalId: 'pro_1',
    clientId: overrides?.clientId ?? 'client_1',
    bookingId: overrides?.bookingId ?? 'booking_1',
    invitedName: 'Tori Morales',
    invitedEmail: 'tori@example.com',
    invitedPhone: null,
    preferredContactMethod:
      overrides?.preferredContactMethod !== undefined
        ? overrides.preferredContactMethod
        : ContactMethod.EMAIL,
    status: overrides?.status ?? ProClientInviteStatus.PENDING,
    acceptedAt:
      overrides?.acceptedAt !== undefined ? overrides.acceptedAt : null,
    acceptedByUserId: null,
    revokedAt: overrides?.revokedAt !== undefined ? overrides.revokedAt : null,
    revokedByUserId: null,
    revokeReason: null,
    createdAt: new Date('2026-04-12T10:00:00.000Z'),
    updatedAt: new Date('2026-04-12T10:00:00.000Z'),
    client:
      overrides?.client !== undefined
        ? overrides.client
        : {
            id: 'client_1',
            userId: null,
            claimStatus: ClientClaimStatus.UNCLAIMED,
            claimedAt: null,
            preferredContactMethod: null,
          },
  }
}

function makeActingClient(overrides?: {
  id?: string
  userId?: string | null
  claimStatus?: ClientClaimStatus
  claimedAt?: Date | null
  preferredContactMethod?: ContactMethod | null
}) {
  return {
    id: overrides?.id ?? 'client_1',
    userId: overrides?.userId !== undefined ? overrides.userId : null,
    claimStatus: overrides?.claimStatus ?? ClientClaimStatus.UNCLAIMED,
    claimedAt:
      overrides?.claimedAt !== undefined ? overrides.claimedAt : null,
    preferredContactMethod:
      overrides?.preferredContactMethod !== undefined
        ? overrides.preferredContactMethod
        : null,
  }
}

describe('acceptClientClaimFromLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => Promise<unknown>) =>
        callback(mocks.tx),
    )

    mocks.getClientClaimLinkByToken.mockResolvedValue(makeInvite())
    mocks.tx.clientProfile.findUnique.mockResolvedValue(makeActingClient())
    mocks.tx.clientProfile.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.clientProfile.update.mockResolvedValue(makeActingClient())
    mocks.markClientClaimLinkAcceptedAudit.mockResolvedValue('ok')
    mocks.mergeUnclaimedClientProfile.mockResolvedValue({
      kind: 'ok',
      moved: {},
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('throws when token is blank after trimming', async () => {
    await expect(
      acceptClientClaimFromLink({
        token: '   ',
        actingUserId: 'user_1',
        actingClientId: 'client_1',
      }),
    ).rejects.toThrow('clientClaim: token is required.')

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('throws when actingUserId is blank after trimming', async () => {
    await expect(
      acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: '   ',
        actingClientId: 'client_1',
      }),
    ).rejects.toThrow('clientClaim: actingUserId is required.')

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('throws when actingClientId is blank after trimming', async () => {
    await expect(
      acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: 'user_1',
        actingClientId: '   ',
      }),
    ).rejects.toThrow('clientClaim: actingClientId is required.')

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns not_found when link does not exist', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(null)

    const result = await acceptClientClaimFromLink({
      token: ' token_1 ',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mocks.getClientClaimLinkByToken).toHaveBeenCalledWith({
      token: 'token_1',
      tx: mocks.tx,
    })
    expect(result).toEqual({ kind: 'not_found' })
  })

  it('returns not_found when link exists but linked client identity is missing', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({ client: null }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'not_found' })
    expect(mocks.tx.clientProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  it('returns revoked when link status is REVOKED', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.REVOKED,
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'revoked' })
    expect(mocks.tx.clientProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  it('returns revoked when revokedAt is already set even if status is still PENDING', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.PENDING,
        revokedAt: new Date('2026-04-12T11:00:00.000Z'),
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'revoked' })
    expect(mocks.tx.clientProfile.findUnique).not.toHaveBeenCalled()
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  it('returns client_not_found when acting client profile does not exist', async () => {
    mocks.tx.clientProfile.findUnique.mockResolvedValueOnce(null)

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'client_not_found' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  /**
   * The heart of this file. A signed-in client on a `ready` link ALWAYS lands
   * here — the link only reads `ready` while its client has `userId == null`, and
   * the acting client's own profile always has `userId != null`, so the ids can
   * never match. This used to return `client_mismatch`, which is why nobody with
   * an account could ever claim.
   */
  describe('signed-in client on a ready link (the merge path)', () => {
    function mockReadyLinkForSignedInClient() {
      mocks.getClientClaimLinkByToken.mockResolvedValue(
        makeInvite({
          clientId: 'client_shell',
          client: {
            id: 'client_shell',
            userId: null,
            claimStatus: ClientClaimStatus.UNCLAIMED,
            claimedAt: null,
            preferredContactMethod: null,
          },
        }),
      )

      // 1st read = the acting client; 2nd = the re-read after the merge.
      mocks.tx.clientProfile.findUnique.mockResolvedValue(
        makeActingClient({ id: 'client_1', userId: 'user_1' }),
      )
    }

    it('absorbs the pro-created shell instead of refusing, and claims', async () => {
      mockReadyLinkForSignedInClient()

      const result = await acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: 'user_1',
        actingClientId: 'client_1',
      })

      expect(mocks.mergeUnclaimedClientProfile).toHaveBeenCalledWith({
        tx: mocks.tx,
        sourceClientId: 'client_shell',
        targetClientId: 'client_1',
        actingUserId: 'user_1',
        now: TEST_NOW,
      })

      expect(result).toEqual({ kind: 'ok', bookingId: 'booking_1' })
      expect(mocks.markClientClaimLinkAcceptedAudit).toHaveBeenCalledWith({
        inviteId: 'invite_1',
        actingUserId: 'user_1',
        acceptedAt: TEST_NOW,
        tx: mocks.tx,
      })
    })

    /**
     * The kill switch. Defaults OFF (the merge runs) — this asserts the escape
     * hatch skips the merge and, critically, that it is checked BEFORE the merge
     * so disabling can never leave a half-absorbed profile behind.
     */
    it('returns merge_paused when DISABLE_CLAIM_MERGE is set, writing nothing', async () => {
      mockReadyLinkForSignedInClient()
      vi.stubEnv('DISABLE_CLAIM_MERGE', '1')

      const result = await acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: 'user_1',
        actingClientId: 'client_1',
      })

      expect(result).toEqual({ kind: 'merge_paused' })
      expect(mocks.mergeUnclaimedClientProfile).not.toHaveBeenCalled()
      expect(mocks.tx.clientProfile.update).not.toHaveBeenCalled()
      expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
      expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
    })

    /**
     * The whole point of the split, stated as one assertion.
     *
     * Both of these refuse the same claim, in the same branch of the same
     * function, and used to be the SAME kind — which is why the surfaces told a
     * blameless viewer to go sign in with an account that cannot exist. They are
     * opposites: the switch is ours and temporary, `target_not_owned` is the
     * caller's and permanent. If a future refactor collapses them back together,
     * this is the test that says no.
     */
    it('distinguishes the kill switch from a genuine mismatch — same branch, different kinds', async () => {
      mockReadyLinkForSignedInClient()
      vi.stubEnv('DISABLE_CLAIM_MERGE', '1')

      const paused = await acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: 'user_1',
        actingClientId: 'client_1',
      })

      vi.stubEnv('DISABLE_CLAIM_MERGE', '')
      mockReadyLinkForSignedInClient()
      mocks.mergeUnclaimedClientProfile.mockResolvedValueOnce({
        kind: 'refused',
        reason: 'target_not_owned',
        details: [],
      })

      const mismatch = await acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: 'user_1',
        actingClientId: 'client_1',
      })

      expect(paused).toEqual({ kind: 'merge_paused' })
      expect(mismatch).toEqual({ kind: 'client_mismatch' })
      expect(paused).not.toEqual(mismatch)
    })

    /**
     * A kill switch must FAIL SAFE. The opt-in flags accept-list their truthy
     * values, and copying that here would mean `DISABLE_CLAIM_MERGE=y` kept an
     * irreversible write running during the emergency it was set to stop.
     */
    it.each([['1'], ['true'], ['yes'], ['y'], ['on'], ['TRUE'], ['  1  '], ['whatever']])(
      'disables the merge for %j — anything set that is not explicitly off',
      async (value) => {
        mockReadyLinkForSignedInClient()
        vi.stubEnv('DISABLE_CLAIM_MERGE', value)

        const result = await acceptClientClaimFromLink({
          token: 'token_1',
          actingUserId: 'user_1',
          actingClientId: 'client_1',
        })

        expect(result).toEqual({ kind: 'merge_paused' })
        expect(mocks.mergeUnclaimedClientProfile).not.toHaveBeenCalled()
      },
    )

    it.each([['0'], ['false'], ['no'], ['off'], [''], ['  ']])(
      'still merges when DISABLE_CLAIM_MERGE is %j (explicitly off)',
      async (value) => {
        mockReadyLinkForSignedInClient()
        vi.stubEnv('DISABLE_CLAIM_MERGE', value)

        const result = await acceptClientClaimFromLink({
          token: 'token_1',
          actingUserId: 'user_1',
          actingClientId: 'client_1',
        })

        expect(result).toEqual({ kind: 'ok', bookingId: 'booking_1' })
        expect(mocks.mergeUnclaimedClientProfile).toHaveBeenCalledTimes(1)
      },
    )

    it('merges when DISABLE_CLAIM_MERGE is unset (the switch is opt-OUT)', async () => {
      mockReadyLinkForSignedInClient()

      const result = await acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: 'user_1',
        actingClientId: 'client_1',
      })

      expect(result).toEqual({ kind: 'ok', bookingId: 'booking_1' })
    })

    it('never merges into a profile the acting user does not own', async () => {
      mockReadyLinkForSignedInClient()
      mocks.mergeUnclaimedClientProfile.mockResolvedValueOnce({
        kind: 'refused',
        reason: 'target_not_owned',
        details: [],
      })

      const result = await acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: 'user_1',
        actingClientId: 'client_1',
      })

      expect(result).toEqual({ kind: 'client_mismatch' })
      expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
    })

    it.each([
      ['cross_tenant'],
      ['source_not_shell'],
      ['thread_collision'],
    ] as const)(
      'surfaces a %s refusal as merge_refused, claiming nothing',
      async (reason) => {
        mockReadyLinkForSignedInClient()
        mocks.mergeUnclaimedClientProfile.mockResolvedValueOnce({
          kind: 'refused',
          reason,
          details: [],
        })

        const result = await acceptClientClaimFromLink({
          token: 'token_1',
          actingUserId: 'user_1',
          actingClientId: 'client_1',
        })

        expect(result).toEqual({ kind: 'merge_refused', reason })
        expect(mocks.tx.clientProfile.update).not.toHaveBeenCalled()
        expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
      },
    )

    /**
     * A refusal that means the world moved under us reports the kind describing
     * the NEW world, not a merge error the viewer can do nothing with.
     */
    it.each([
      ['source_not_unclaimed', 'already_claimed'],
      ['source_not_found', 'not_found'],
      ['target_not_found', 'client_not_found'],
      ['same_profile', 'conflict'],
    ] as const)('maps a %s refusal to %s', async (reason, kind) => {
      mockReadyLinkForSignedInClient()
      mocks.mergeUnclaimedClientProfile.mockResolvedValueOnce({
        kind: 'refused',
        reason,
        details: [],
      })

      const result = await acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: 'user_1',
        actingClientId: 'client_1',
      })

      expect(result).toEqual({ kind })
      expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
    })

    it('re-reads the target after the merge rather than trusting the pre-merge row', async () => {
      mockReadyLinkForSignedInClient()
      mocks.getClientClaimLinkByToken.mockResolvedValue(
        makeInvite({
          clientId: 'client_shell',
          preferredContactMethod: ContactMethod.EMAIL,
          client: {
            id: 'client_shell',
            userId: null,
            claimStatus: ClientClaimStatus.UNCLAIMED,
            claimedAt: null,
            preferredContactMethod: ContactMethod.EMAIL,
          },
        }),
      )

      // The merge carries the shell's contact preference across, so the row read
      // BEFORE it ran is stale. Trusting it would overwrite the just-merged value.
      mocks.tx.clientProfile.findUnique
        .mockResolvedValueOnce(
          makeActingClient({ id: 'client_1', userId: 'user_1' }),
        )
        .mockResolvedValueOnce(
          makeActingClient({
            id: 'client_1',
            userId: 'user_1',
            preferredContactMethod: ContactMethod.EMAIL,
          }),
        )

      await acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: 'user_1',
        actingClientId: 'client_1',
      })

      expect(mocks.tx.clientProfile.update).toHaveBeenCalledWith({
        where: { id: 'client_1' },
        data: {
          claimStatus: ClientClaimStatus.CLAIMED,
          claimedAt: TEST_NOW,
        },
      })
    })

    /**
     * A target that adopted another pro's shell earlier is ALREADY CLAIMED. The
     * merge is the substantive work and CLAIMED is already the state we wanted,
     * so this is success — the old `updateMany`-with-UNCLAIMED-guard would have
     * reported `already_claimed` while the history had in fact just moved.
     */
    it('claims a target that was already CLAIMED by an earlier merge, keeping its original claimedAt', async () => {
      const firstClaimedAt = new Date('2026-01-01T00:00:00.000Z')

      mockReadyLinkForSignedInClient()
      mocks.tx.clientProfile.findUnique.mockResolvedValue(
        makeActingClient({
          id: 'client_1',
          userId: 'user_1',
          claimStatus: ClientClaimStatus.CLAIMED,
          claimedAt: firstClaimedAt,
          // Already has an opinion, so nothing is carried over — this test is
          // about claimedAt alone.
          preferredContactMethod: ContactMethod.SMS,
        }),
      )

      const result = await acceptClientClaimFromLink({
        token: 'token_1',
        actingUserId: 'user_1',
        actingClientId: 'client_1',
      })

      expect(result).toEqual({ kind: 'ok', bookingId: 'booking_1' })
      expect(mocks.tx.clientProfile.update).toHaveBeenCalledWith({
        where: { id: 'client_1' },
        data: {
          claimStatus: ClientClaimStatus.CLAIMED,
          claimedAt: firstClaimedAt,
        },
      })
      expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
    })

    /**
     * Past the merge, a failure must THROW so the transaction rolls back — Prisma
     * commits when the callback resolves, so returning would commit the very
     * absorption being reported as failed. This asserts the caller still sees the
     * right result; that the rows actually unwind is only provable against real
     * Postgres (tests/integration/claim-accept-merge.test.ts).
     */
    it.each([
      ['revoked', 'revoked'],
      ['not_found', 'not_found'],
      ['conflict', 'conflict'],
    ] as const)(
      'rolls the merge back when the audit comes back %s',
      async (auditResult, kind) => {
        mockReadyLinkForSignedInClient()
        mocks.markClientClaimLinkAcceptedAudit.mockResolvedValueOnce(auditResult)

        const transactionCallback = vi.fn()
        mocks.prisma.$transaction.mockImplementationOnce(
          async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => {
            transactionCallback.mockImplementation(callback)
            return transactionCallback(mocks.tx)
          },
        )

        const result = await acceptClientClaimFromLink({
          token: 'token_1',
          actingUserId: 'user_1',
          actingClientId: 'client_1',
        })

        expect(result).toEqual({ kind })
        // Rejecting the callback is what makes Prisma roll back; resolving it
        // would commit the merge.
        await expect(transactionCallback.mock.results[0]?.value).rejects.toThrow(
          'rolled back after the merge had already moved rows',
        )
      },
    )
  })

  it('returns already_claimed when link belongs to a different claimed client identity', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_other',
          userId: 'user_other',
          claimStatus: ClientClaimStatus.CLAIMED,
          claimedAt: new Date('2026-04-12T09:00:00.000Z'),
          preferredContactMethod: null,
        },
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'already_claimed' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  it('returns already_claimed when linked client identity is already claimed', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_1',
          userId: null,
          claimStatus: ClientClaimStatus.CLAIMED,
          claimedAt: new Date('2026-04-12T09:00:00.000Z'),
          preferredContactMethod: null,
        },
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'already_claimed' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  it('returns already_claimed when linked client has a different linked user already', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        client: {
          id: 'client_1',
          userId: 'user_other',
          claimStatus: ClientClaimStatus.UNCLAIMED,
          claimedAt: null,
          preferredContactMethod: null,
        },
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'already_claimed' })
    expect(mocks.tx.clientProfile.updateMany).not.toHaveBeenCalled()
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  it('claims the client identity successfully and writes preferredContactMethod when acting client does not have one', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        id: 'invite_1',
        bookingId: 'booking_1',
        preferredContactMethod: ContactMethod.EMAIL,
        client: {
          id: 'client_1',
          userId: null,
          claimStatus: ClientClaimStatus.UNCLAIMED,
          claimedAt: null,
          preferredContactMethod: null,
        },
      }),
    )

    mocks.tx.clientProfile.findUnique.mockResolvedValueOnce(
      makeActingClient({
        id: 'client_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        preferredContactMethod: null,
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(mocks.tx.clientProfile.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'client_1',
        claimStatus: ClientClaimStatus.UNCLAIMED,
      },
      data: {
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
      kind: 'ok',
      bookingId: 'booking_1',
    })

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('claims successfully without overwriting an existing preferredContactMethod', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        preferredContactMethod: ContactMethod.EMAIL,
      }),
    )

    mocks.tx.clientProfile.findUnique.mockResolvedValueOnce(
      makeActingClient({
        id: 'client_1',
        preferredContactMethod: ContactMethod.SMS,
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(mocks.tx.clientProfile.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'client_1',
        claimStatus: ClientClaimStatus.UNCLAIMED,
      },
      data: {
        claimStatus: ClientClaimStatus.CLAIMED,
        claimedAt: TEST_NOW,
      },
    })

    expect(result).toEqual({
      kind: 'ok',
      bookingId: 'booking_1',
    })
  })

  it('claims successfully without writing preferredContactMethod when invite has none', async () => {
    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        preferredContactMethod: null,
      }),
    )

    mocks.tx.clientProfile.findUnique.mockResolvedValueOnce(
      makeActingClient({
        id: 'client_1',
        preferredContactMethod: null,
      }),
    )

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(mocks.tx.clientProfile.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'client_1',
        claimStatus: ClientClaimStatus.UNCLAIMED,
      },
      data: {
        claimStatus: ClientClaimStatus.CLAIMED,
        claimedAt: TEST_NOW,
      },
    })

    expect(result).toEqual({
      kind: 'ok',
      bookingId: 'booking_1',
    })
  })

  it('preserves an existing invite acceptedAt timestamp when writing acceptance audit', async () => {
    const acceptedAt = new Date('2026-04-12T11:00:00.000Z')

    mocks.getClientClaimLinkByToken.mockResolvedValueOnce(
      makeInvite({
        acceptedAt,
      }),
    )

    await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(mocks.markClientClaimLinkAcceptedAudit).toHaveBeenCalledWith({
      inviteId: 'invite_1',
      actingUserId: 'user_1',
      acceptedAt,
      tx: mocks.tx,
    })
  })

  it('returns already_claimed when client claim update loses a race to a claimed state', async () => {
    mocks.tx.clientProfile.updateMany.mockResolvedValueOnce({ count: 0 })
    mocks.tx.clientProfile.findUnique
      .mockResolvedValueOnce(makeActingClient())
      .mockResolvedValueOnce({
        id: 'client_1',
        userId: 'user_1',
        claimStatus: ClientClaimStatus.CLAIMED,
      })

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'already_claimed' })
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  it('returns client_not_found when client claim update loses a race to deletion', async () => {
    mocks.tx.clientProfile.updateMany.mockResolvedValueOnce({ count: 0 })
    mocks.tx.clientProfile.findUnique
      .mockResolvedValueOnce(makeActingClient())
      .mockResolvedValueOnce(null)

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'client_not_found' })
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  it('returns conflict when client claim update does not succeed and client is still unclaimed', async () => {
    mocks.tx.clientProfile.updateMany.mockResolvedValueOnce({ count: 0 })
    mocks.tx.clientProfile.findUnique
      .mockResolvedValueOnce(makeActingClient())
      .mockResolvedValueOnce({
        id: 'client_1',
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      })

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'conflict' })
    expect(mocks.markClientClaimLinkAcceptedAudit).not.toHaveBeenCalled()
  })

  it('returns revoked when acceptance audit loses a race to revocation', async () => {
    mocks.markClientClaimLinkAcceptedAudit.mockResolvedValueOnce('revoked')

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'revoked' })
  })

  it('returns not_found when acceptance audit loses a race to deletion', async () => {
    mocks.markClientClaimLinkAcceptedAudit.mockResolvedValueOnce('not_found')

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'not_found' })
  })

  it('returns conflict when acceptance audit does not succeed and link is still not revoked', async () => {
    mocks.markClientClaimLinkAcceptedAudit.mockResolvedValueOnce('conflict')

    const result = await acceptClientClaimFromLink({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })

    expect(result).toEqual({ kind: 'conflict' })
  })
})