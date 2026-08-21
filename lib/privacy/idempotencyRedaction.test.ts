import { describe, expect, it, vi } from 'vitest'

import { DELETE_RULES } from '@/lib/privacy/deleteRules'
import { DELETE_BOUNDARY } from '@/lib/privacy/deleteBoundary'

const SUBJECT = {
  userId: 'user_1',
  clientProfileId: 'client_1',
  professionalProfileId: null,
}

function rule() {
  const found = DELETE_RULES.find((r) => r.model === 'IdempotencyKey')
  if (!found) throw new Error('IdempotencyKey has no delete rule')
  return found
}

describe('account deletion clears the idempotency ledger body', () => {
  it('is declared ANONYMIZE, not RETAIN', () => {
    // It was RETAIN until 2026-08-21 on a justification that did not match the
    // schema. Flipping it back would silently restore indefinite PII retention.
    expect(DELETE_BOUNDARY.IdempotencyKey?.status).toBe('ANONYMIZE')
  })

  it('clears the stored response body for the deleted user', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    const db = { idempotencyKey: { updateMany, count: vi.fn() } }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applied = await rule().apply(db as never, SUBJECT)

    expect(applied).toBe(2)
    const call = updateMany.mock.calls[0]?.[0]
    expect(call.where).toEqual({ actorUserId: 'user_1' })
    expect(call.data).toHaveProperty('responseBodyJson')
  })

  // The row itself must survive: the actor id is part of the dedupe scope, so
  // deleting it lets a replay of a pre-deletion request through.
  it('does not delete the row', () => {
    expect(rule().action).toBe('ANONYMIZE')
    expect(rule().action).not.toBe('DELETE')
  })
})
