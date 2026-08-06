// tests/integration/account-deletion-failure-alert.test.ts
//
// Real-Postgres proof that a per-request failure inside the account-deletion
// sweep pages a human. `deleteUserData` is mocked to force the failure
// deterministically (real Postgres would happily complete this deletion —
// forcing a genuine FK violation on purpose would mean re-breaking the exact
// bug account-deletion-boundary.test.ts exists to keep fixed). Everything
// downstream of the throw — the FAILED status write, the failure count, and
// the Sentry capture — is real.
//
// Run: pnpm test:integration

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AccountDeletionRequestStatus,
  PrismaClient,
  Role,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  deleteUserData: vi.fn(),
  capturePrivacyException: vi.fn(),
}))

vi.mock('@/lib/privacy/deleteUserData', () => ({
  deleteUserData: mocks.deleteUserData,
}))

vi.mock('@/lib/observability/privacyEvents', () => ({
  capturePrivacyException: mocks.capturePrivacyException,
}))

import { executeDueAccountDeletions } from '@/lib/privacy/accountDeletion'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const tag = `acctdelfail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const DAY_MS = 24 * 60 * 60 * 1000

let userId: string
let requestId: string

beforeAll(async () => {
  const user = await db.user.create({
    data: {
      email: `${tag}@example.com`,
      password: 'test-password',
      role: Role.CLIENT,
    },
    select: { id: true },
  })
  userId = user.id
}, 30_000)

beforeEach(async () => {
  mocks.deleteUserData.mockReset()
  mocks.capturePrivacyException.mockReset()

  const request = await db.accountDeletionRequest.create({
    data: {
      userId,
      requestedAt: new Date(Date.now() - 15 * DAY_MS),
      scheduledFor: new Date(Date.now() - 1 * DAY_MS),
      status: AccountDeletionRequestStatus.PENDING,
    },
    select: { id: true },
  })
  requestId = request.id
})

afterEach(async () => {
  await db.accountDeletionRequest.deleteMany({ where: { userId } })
})

afterAll(async () => {
  await db.user.deleteMany({ where: { id: userId } })
  await db.$disconnect()
})

describe('executeDueAccountDeletions — a per-request failure pages a human', () => {
  it('marks the request FAILED and captures a privacy exception with its id', async () => {
    const error = new Error('deleteUserData exploded')
    mocks.deleteUserData.mockRejectedValue(error)

    const result = await executeDueAccountDeletions({ db })

    expect(result.failed).toBe(1)
    expect(result.completed).toBe(0)

    const row = await db.accountDeletionRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true, failureCount: true, lastFailureMessage: true },
    })
    expect(row.status).toBe(AccountDeletionRequestStatus.FAILED)
    expect(row.failureCount).toBe(1)
    expect(row.lastFailureMessage).toContain('deleteUserData exploded')

    expect(mocks.capturePrivacyException).toHaveBeenCalledTimes(1)
    expect(mocks.capturePrivacyException).toHaveBeenCalledWith({
      error,
      route: 'internal/jobs/account-deletion',
      event: 'ACCOUNT_DELETION_REQUEST_FAILED',
      userId,
      requestId,
    })
  })

  it('does not capture a privacy exception when the deletion succeeds', async () => {
    mocks.deleteUserData.mockResolvedValue({
      executedAt: new Date().toISOString(),
      mode: 'ANONYMIZE',
      subject: { userId, clientProfileId: null, professionalProfileId: null },
      requestedByUserId: userId,
      reason: `Self-serve account deletion request ${requestId}`,
      actions: [],
      limitations: [],
    })

    const result = await executeDueAccountDeletions({ db })

    expect(result.completed).toBe(1)
    expect(mocks.capturePrivacyException).not.toHaveBeenCalled()
  })
})
