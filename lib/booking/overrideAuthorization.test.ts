import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingOverridePermissionScope,
  BookingOverrideRule,
  Role,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
    },
  },
}))

import { assertCanUseBookingOverride } from './overrideAuthorization'

describe('assertCanUseBookingOverride', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-22T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects missing actor user id', async () => {
    await expect(
      assertCanUseBookingOverride({
        actorUserId: '   ',
        professionalId: 'pro_1',
        rule: 'ADVANCE_NOTICE',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.userFindUnique).not.toHaveBeenCalled()
  })

  it('rejects missing professional id', async () => {
    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_1',
        professionalId: '   ',
        rule: 'ADVANCE_NOTICE',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.userFindUnique).not.toHaveBeenCalled()
  })

  it('rejects unsupported rules', async () => {
    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_1',
        professionalId: 'pro_1',
        rule: 'NOT_REAL' as never,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.userFindUnique).not.toHaveBeenCalled()
  })

  it('rejects when actor user is not found', async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null)

    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_missing',
        professionalId: 'pro_1',
        rule: 'ADVANCE_NOTICE',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.userFindUnique).toHaveBeenCalledTimes(1)
  })

  it('rejects client users', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user_client',
      role: Role.CLIENT,
      professionalProfile: null,
      bookingOverridePermissionsAsActor: [],
    })

    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_client',
        professionalId: 'pro_1',
        rule: 'ADVANCE_NOTICE',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects when there is no matching permission', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user_pro_1',
      role: Role.PRO,
      professionalProfile: {
        id: 'pro_1',
        userId: 'user_pro_1',
      },
      bookingOverridePermissionsAsActor: [],
    })

    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_pro_1',
        professionalId: 'pro_1',
        rule: 'ADVANCE_NOTICE',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('allows SELF_ONLY for the actor’s own professional profile', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user_pro_1',
      role: Role.PRO,
      professionalProfile: {
        id: 'pro_1',
        userId: 'user_pro_1',
      },
      bookingOverridePermissionsAsActor: [
        {
          id: 'perm_1',
          rule: BookingOverrideRule.ADVANCE_NOTICE,
          scope: BookingOverridePermissionScope.SELF_ONLY,
          professionalId: 'pro_1',
          startsAt: null,
          expiresAt: null,
        },
      ],
    })

    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_pro_1',
        professionalId: 'pro_1',
        rule: 'ADVANCE_NOTICE',
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects SELF_ONLY for another professional', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user_pro_1',
      role: Role.PRO,
      professionalProfile: {
        id: 'pro_1',
        userId: 'user_pro_1',
      },
      bookingOverridePermissionsAsActor: [
        {
          id: 'perm_1',
          rule: BookingOverrideRule.ADVANCE_NOTICE,
          scope: BookingOverridePermissionScope.SELF_ONLY,
          professionalId: 'pro_1',
          startsAt: null,
          expiresAt: null,
        },
      ],
    })

    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_pro_1',
        professionalId: 'pro_2',
        rule: 'ADVANCE_NOTICE',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('allows PROFESSIONAL_TEAM for the matching professional', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user_support_1',
      role: Role.ADMIN,
      professionalProfile: null,
      bookingOverridePermissionsAsActor: [
        {
          id: 'perm_2',
          rule: BookingOverrideRule.WORKING_HOURS,
          scope: BookingOverridePermissionScope.PROFESSIONAL_TEAM,
          professionalId: 'pro_7',
          startsAt: null,
          expiresAt: null,
        },
      ],
    })

    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_support_1',
        professionalId: 'pro_7',
        rule: 'WORKING_HOURS',
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects PROFESSIONAL_TEAM for a different professional', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user_support_1',
      role: Role.ADMIN,
      professionalProfile: null,
      bookingOverridePermissionsAsActor: [
        {
          id: 'perm_2',
          rule: BookingOverrideRule.WORKING_HOURS,
          scope: BookingOverridePermissionScope.PROFESSIONAL_TEAM,
          professionalId: 'pro_7',
          startsAt: null,
          expiresAt: null,
        },
      ],
    })

    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_support_1',
        professionalId: 'pro_8',
        rule: 'WORKING_HOURS',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('allows ANY_PROFESSIONAL regardless of target professional', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user_admin_1',
      role: Role.ADMIN,
      professionalProfile: null,
      bookingOverridePermissionsAsActor: [
        {
          id: 'perm_3',
          rule: BookingOverrideRule.MAX_DAYS_AHEAD,
          scope: BookingOverridePermissionScope.ANY_PROFESSIONAL,
          professionalId: null,
          startsAt: null,
          expiresAt: null,
        },
      ],
    })

    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_admin_1',
        professionalId: 'pro_999',
        rule: 'MAX_DAYS_AHEAD',
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects permissions that have not started yet', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user_admin_1',
      role: Role.ADMIN,
      professionalProfile: null,
      bookingOverridePermissionsAsActor: [
        {
          id: 'perm_4',
          rule: BookingOverrideRule.MAX_DAYS_AHEAD,
          scope: BookingOverridePermissionScope.ANY_PROFESSIONAL,
          professionalId: null,
          startsAt: new Date('2026-03-23T00:00:00.000Z'),
          expiresAt: null,
        },
      ],
    })

    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_admin_1',
        professionalId: 'pro_999',
        rule: 'MAX_DAYS_AHEAD',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects expired permissions', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user_admin_1',
      role: Role.ADMIN,
      professionalProfile: null,
      bookingOverridePermissionsAsActor: [
        {
          id: 'perm_5',
          rule: BookingOverrideRule.MAX_DAYS_AHEAD,
          scope: BookingOverridePermissionScope.ANY_PROFESSIONAL,
          professionalId: null,
          startsAt: null,
          expiresAt: new Date('2026-03-22T11:59:59.000Z'),
        },
      ],
    })

    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_admin_1',
        professionalId: 'pro_999',
        rule: 'MAX_DAYS_AHEAD',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('ignores permissions for other rules', async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: 'user_admin_1',
      role: Role.ADMIN,
      professionalProfile: null,
      bookingOverridePermissionsAsActor: [
        {
          id: 'perm_6',
          rule: BookingOverrideRule.WORKING_HOURS,
          scope: BookingOverridePermissionScope.ANY_PROFESSIONAL,
          professionalId: null,
          startsAt: null,
          expiresAt: null,
        },
      ],
    })

    await expect(
      assertCanUseBookingOverride({
        actorUserId: 'user_admin_1',
        professionalId: 'pro_999',
        rule: 'MAX_DAYS_AHEAD',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})