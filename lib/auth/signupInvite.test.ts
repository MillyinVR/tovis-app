import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    signupInvite: {
      findUnique: mocks.findUnique,
    },
  },
}))

import {
  SignupInviteError,
  consumeSignupInvite,
  generateSignupInviteCode,
  normalizeSignupInviteCode,
  signupInviteCodeHash,
  validateSignupInviteCode,
} from './signupInvite'

const NOW = new Date('2026-09-08T12:00:00.000Z')

describe('signupInvite', () => {
  beforeEach(() => {
    mocks.findUnique.mockReset()
  })

  it('generates a high-entropy, human-readable code and hashes normalized input', () => {
    const code = generateSignupInviteCode()
    expect(code).toMatch(/^TVS(?:-[23456789A-HJ-NP-Z]{4}){5}$/)
    expect(normalizeSignupInviteCode(code.toLowerCase())).toBe(
      code.replaceAll('-', ''),
    )
    expect(signupInviteCodeHash(code)).toHaveLength(64)
    expect(signupInviteCodeHash(code.toLowerCase().replaceAll('-', ' '))).toBe(
      signupInviteCodeHash(code),
    )
  })

  it('requires a code without querying the database', async () => {
    await expect(validateSignupInviteCode({ rawCode: '  ', now: NOW })).resolves.toEqual({
      ok: false,
      reason: 'missing',
    })
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('accepts an active unused code and explains expired or used codes', async () => {
    mocks.findUnique
      .mockResolvedValueOnce({
        id: 'invite_active',
        label: 'Jane',
        expiresAt: new Date('2026-09-09T12:00:00.000Z'),
        usedAt: null,
        revokedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'invite_expired',
        label: 'Ari',
        expiresAt: new Date('2026-09-07T12:00:00.000Z'),
        usedAt: null,
        revokedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'invite_used',
        label: 'Sam',
        expiresAt: new Date('2026-09-09T12:00:00.000Z'),
        usedAt: new Date('2026-09-08T11:00:00.000Z'),
        revokedAt: null,
      })

    await expect(validateSignupInviteCode({ rawCode: 'TVS-AAAA', now: NOW })).resolves.toEqual({ ok: true })
    await expect(validateSignupInviteCode({ rawCode: 'TVS-BBBB', now: NOW })).resolves.toEqual({ ok: false, reason: 'expired' })
    await expect(validateSignupInviteCode({ rawCode: 'TVS-CCCC', now: NOW })).resolves.toEqual({ ok: false, reason: 'used' })
  })

  it('consumes exactly one active code for the newly created user', async () => {
    const tx = {
      signupInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ id: 'invite_1', label: 'Jane' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'invite_1', label: 'Jane' }),
      },
    }

    await expect(
      consumeSignupInvite({
        rawCode: 'TVS-ABCD-EFGH',
        userId: 'user_1',
        tx,
        now: NOW,
      }),
    ).resolves.toEqual({ id: 'invite_1', label: 'Jane' })

    expect(tx.signupInvite.updateMany).toHaveBeenCalledWith({
      where: {
        codeHash: signupInviteCodeHash('TVS-ABCD-EFGH'),
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { usedAt: NOW, usedByUserId: 'user_1' },
    })
  })

  it('rejects the loser of a concurrent one-code race', async () => {
    const tx = {
      signupInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'invite_1',
          label: 'Jane',
          expiresAt: new Date('2026-09-09T12:00:00.000Z'),
          usedAt: NOW,
          revokedAt: null,
        }),
        findUniqueOrThrow: vi.fn(),
      },
    }

    const result = consumeSignupInvite({
      rawCode: 'TVS-ABCD-EFGH',
      userId: 'user_2',
      tx,
      now: NOW,
    })

    await expect(result).rejects.toBeInstanceOf(SignupInviteError)
    await expect(result).rejects.toMatchObject({ reason: 'used' })
    expect(tx.signupInvite.findUniqueOrThrow).not.toHaveBeenCalled()
  })
})
