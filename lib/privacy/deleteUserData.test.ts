// lib/privacy/deleteUserData.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

import {
  DELETE_USER_DATA_LIMITATIONS,
  deleteUserData,
  USER_DATA_DELETE_VERSION,
} from './deleteUserData'
import { DELETE_RULES } from './deleteRules'

/**
 * Contract-level tests for the deletion boundary.
 *
 * ⚠️ These are MOCKS, and mocks are why this file used to be misleading: a
 * stubbed `deleteMany` returns `{count: n}` no matter what the database would
 * have said, so the suite stayed green for months while `ProfessionalLocation`
 * deletion raised a foreign-key violation against real Postgres for any pro who
 * had ever taken a booking.
 *
 * Row-level truth therefore lives in
 * tests/integration/account-deletion-boundary.test.ts, which runs against real
 * Postgres. What is proved HERE is only what mocks can honestly prove: the
 * shape of the contract, transaction wrapping, dry-run purity, and that no raw
 * PII escapes into the result payload.
 */

type MockDelegate = {
  count: ReturnType<typeof vi.fn>
  deleteMany: ReturnType<typeof vi.fn>
  updateMany: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  findUnique: ReturnType<typeof vi.fn>
}

/**
 * A Prisma-shaped mock that materializes a delegate on first access.
 *
 * Written as a Proxy rather than fifty hand-listed stubs so that adding a rule
 * to `DELETE_RULES` cannot break this file for a reason that has nothing to do
 * with what it is testing.
 */
function makeMockDb(): {
  db: Record<string, MockDelegate> & { $transaction: ReturnType<typeof vi.fn> }
  delegates: Map<string, MockDelegate>
} {
  const delegates = new Map<string, MockDelegate>()
  const $transaction = vi.fn()

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, property: string | symbol) {
      if (property === '$transaction') return $transaction
      if (typeof property !== 'string') return undefined

      const existing = delegates.get(property)
      if (existing) return existing

      const delegate: MockDelegate = {
        count: vi.fn().mockResolvedValue(1),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
      }
      delegates.set(property, delegate)
      return delegate
    },
    // `canRunTransaction` asks `'$transaction' in db`, which routes through
    // this trap — without it the proxy reports the key as absent and live
    // anonymization silently runs outside a transaction.
    has(_target, property) {
      return property === '$transaction' || typeof property === 'string'
    },
  }

  const proxy = new Proxy<Record<string, unknown>>({}, handler)

  return {
    // The executor only ever reaches for model delegates and $transaction.
    db: proxy as never,
    delegates,
  }
}

function makeUser(args?: {
  id?: string
  clientProfile?: null | { id: string }
  professionalProfile?: null | { id: string }
}) {
  return {
    id: args?.id ?? 'user_1',
    email: 'person@example.com',
    emailHashV2: 'hmac_email_hash_v2',
    emailHashKeyVersion: 1,
    phone: '+16195551234',
    phoneHashV2: 'hmac_phone_hash_v2',
    phoneHashKeyVersion: 1,
    password: 'stored_hash',
    role: Role.CLIENT,
    clientProfile:
      args?.clientProfile === undefined
        ? { id: 'client_1' }
        : args.clientProfile,
    professionalProfile:
      args?.professionalProfile === undefined
        ? { id: 'pro_1' }
        : args.professionalProfile,
  }
}

let harness: ReturnType<typeof makeMockDb>

/**
 * The proxy materializes delegates on access, so every model is present at
 * runtime; the index signature just cannot say so. This narrows once instead of
 * scattering non-null assertions through the assertions.
 */
function delegate(model: string): MockDelegate {
  const found = harness.db[model]
  if (!found) throw new Error(`mock delegate missing: ${model}`)
  return found
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'))
  harness = makeMockDb()
  harness.db.$transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) => callback(harness.db),
  )
  delegate('user').findUnique.mockResolvedValue(makeUser())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('deleteUserData', () => {
  it('exports a stable privacy delete contract version', () => {
    expect(USER_DATA_DELETE_VERSION).toBe(1)
  })

  it('throws when the subject user does not exist', async () => {
    delegate('user').findUnique.mockResolvedValueOnce(null)

    await expect(
      deleteUserData({
        db: harness.db as never,
        userId: 'missing_user',
        mode: 'DRY_RUN',
        requestedByUserId: 'admin_1',
        reason: 'privacy request',
      }),
    ).rejects.toThrow('Cannot delete user data: user not found (missing_user)')

    expect(delegate('user').update).not.toHaveBeenCalled()
  })

  it('reports an action for every rule plus the three subject rows', async () => {
    const result = await deleteUserData({
      db: harness.db as never,
      userId: 'user_1',
      mode: 'DRY_RUN',
      requestedByUserId: 'admin_1',
      reason: 'user requested deletion',
    })

    expect(result.actions).toHaveLength(DELETE_RULES.length + 3)

    const models = result.actions.map((action) => action.model)
    for (const rule of DELETE_RULES) {
      expect(models).toContain(rule.model)
    }
    expect(models).toContain('User')
    expect(models).toContain('ClientProfile')
    expect(models).toContain('ProfessionalProfile')
  })

  it('does not mutate anything in DRY_RUN', async () => {
    const result = await deleteUserData({
      db: harness.db as never,
      userId: 'user_1',
      mode: 'DRY_RUN',
      requestedByUserId: 'admin_1',
      reason: 'user requested deletion',
    })

    expect(result.mode).toBe('DRY_RUN')
    expect(
      result.actions.every((action) =>
        ['WOULD_DELETE', 'WOULD_ANONYMIZE', 'SKIPPED'].includes(action.action),
      ),
    ).toBe(true)

    for (const [model, delegate] of harness.delegates) {
      expect(delegate.deleteMany, `${model}.deleteMany`).not.toHaveBeenCalled()
      expect(delegate.updateMany, `${model}.updateMany`).not.toHaveBeenCalled()
      expect(delegate.update, `${model}.update`).not.toHaveBeenCalled()
    }
  })

  it('skips profile-scoped rules when the user has neither profile', async () => {
    delegate('user').findUnique.mockResolvedValue(
      makeUser({ clientProfile: null, professionalProfile: null }),
    )

    const result = await deleteUserData({
      db: harness.db as never,
      userId: 'user_1',
      mode: 'DRY_RUN',
      requestedByUserId: 'admin_1',
      reason: 'privacy request',
    })

    const clientOnly = result.actions.find(
      (action) => action.model === 'ClientAddress',
    )
    expect(clientOnly?.action).toBe('SKIPPED')

    const proOnly = result.actions.find(
      (action) => action.model === 'PracticeShot',
    )
    expect(proOnly?.action).toBe('SKIPPED')

    // A user-scoped rule still applies — the subject always has a user id.
    const userScoped = result.actions.find(
      (action) => action.model === 'DeviceToken',
    )
    expect(userScoped?.action).toBe('WOULD_DELETE')
  })

  it('wraps live anonymization in a transaction', async () => {
    await deleteUserData({
      db: harness.db as never,
      userId: 'user_1',
      mode: 'ANONYMIZE',
      requestedByUserId: 'admin_1',
      reason: 'privacy request',
    })

    expect(harness.db.$transaction).toHaveBeenCalledTimes(1)
  })

  it('does not open a transaction for a dry run', async () => {
    await deleteUserData({
      db: harness.db as never,
      userId: 'user_1',
      mode: 'DRY_RUN',
      requestedByUserId: 'admin_1',
      reason: 'privacy request',
    })

    expect(harness.db.$transaction).not.toHaveBeenCalled()
  })

  it('clears both contact fields and their lookup hashes on the user row', async () => {
    await deleteUserData({
      db: harness.db as never,
      userId: 'user_1',
      mode: 'ANONYMIZE',
      requestedByUserId: 'admin_1',
      reason: 'privacy request',
    })

    const call = delegate('user').update.mock.calls.at(0)
    expect(call).toBeDefined()
    const data = call?.[0]?.data

    // A cleared plaintext column with a surviving blind index would still let
    // the deleted account be found by email or phone.
    expect(data.phone).toBeNull()
    expect(data.emailHashV2).toBeNull()
    expect(data.emailHashKeyVersion).toBeNull()
    expect(data.phoneHashV2).toBeNull()
    expect(data.phoneHashKeyVersion).toBeNull()
    expect(data.email).not.toBe('person@example.com')
    expect(data.password).not.toBe('stored_hash')
  })

  it('does not leak raw user PII into the result payload', async () => {
    const result = await deleteUserData({
      db: harness.db as never,
      userId: 'user_1',
      mode: 'ANONYMIZE',
      requestedByUserId: 'admin_1',
      reason: 'privacy request',
    })

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('person@example.com')
    expect(serialized).not.toContain('+16195551234')
    expect(serialized).not.toContain('hmac_email_hash_v2')
    expect(serialized).not.toContain('stored_hash')
  })

  it('states what a completed deletion still does not do', () => {
    // The limitations are the honest part of the contract. An empty list would
    // claim a completeness the boundary does not have.
    expect(DELETE_USER_DATA_LIMITATIONS.length).toBeGreaterThan(0)
    expect(DELETE_USER_DATA_LIMITATIONS.join(' ')).toContain('Storage object')
  })
})
