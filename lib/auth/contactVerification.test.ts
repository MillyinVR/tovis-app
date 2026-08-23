// lib/auth/contactVerification.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  markUserEmailVerified,
  markUserPhoneVerified,
} from './contactVerification'

const VERIFIED_AT = new Date('2026-04-12T12:00:00.000Z')

function makeTx() {
  return {
    user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    clientProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    professionalProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  }
}

describe('markUserPhoneVerified', () => {
  let tx: ReturnType<typeof makeTx>

  beforeEach(() => {
    tx = makeTx()
  })

  it('stamps User guarded on a still-null timestamp and fans to the client profile', async () => {
    await markUserPhoneVerified(tx as never, {
      userId: 'user_1',
      role: 'CLIENT',
      verifiedAt: VERIFIED_AT,
    })

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user_1', phoneVerifiedAt: null },
      data: { phoneVerifiedAt: VERIFIED_AT },
    })
    expect(tx.clientProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', phoneVerifiedAt: null },
      data: { phoneVerifiedAt: VERIFIED_AT },
    })
    expect(tx.professionalProfile.updateMany).not.toHaveBeenCalled()
  })

  it('fans to the professional profile for a PRO', async () => {
    await markUserPhoneVerified(tx as never, {
      userId: 'user_2',
      role: 'PRO',
      verifiedAt: VERIFIED_AT,
    })

    expect(tx.professionalProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_2', phoneVerifiedAt: null },
      data: { phoneVerifiedAt: VERIFIED_AT },
    })
    expect(tx.clientProfile.updateMany).not.toHaveBeenCalled()
  })

  it('touches no profile table for an ADMIN', async () => {
    await markUserPhoneVerified(tx as never, {
      userId: 'user_3',
      role: 'ADMIN',
      verifiedAt: VERIFIED_AT,
    })

    expect(tx.user.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.clientProfile.updateMany).not.toHaveBeenCalled()
    expect(tx.professionalProfile.updateMany).not.toHaveBeenCalled()
  })
})

describe('markUserEmailVerified', () => {
  it('stamps only User — the schema keeps email verification there alone', async () => {
    const tx = makeTx()

    await markUserEmailVerified(tx as never, {
      userId: 'user_1',
      verifiedAt: VERIFIED_AT,
    })

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user_1', emailVerifiedAt: null },
      data: { emailVerifiedAt: VERIFIED_AT },
    })
    expect(tx.clientProfile.updateMany).not.toHaveBeenCalled()
    expect(tx.professionalProfile.updateMany).not.toHaveBeenCalled()
  })
})
