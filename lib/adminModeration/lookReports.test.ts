import { describe, expect, it, vi } from 'vitest'

import {
  dismissLookCommentReports,
  dismissLookPostReports,
} from './lookReports'

const NOW = new Date('2026-07-04T12:00:00Z')

describe('dismissLookPostReports', () => {
  it('resolves all unresolved reports and returns the count + scope', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 })
    const findUnique = vi.fn().mockResolvedValue({
      id: 'look_1',
      professionalId: 'pro_1',
      serviceId: 'svc_1',
    })

    const result = await dismissLookPostReports(
      { lookPost: { findUnique }, lookPostReport: { updateMany } },
      { lookPostId: 'look_1', adminUserId: 'admin_1', now: NOW },
    )

    expect(updateMany).toHaveBeenCalledWith({
      where: { lookPostId: 'look_1', resolvedAt: null },
      data: { resolvedAt: NOW, resolvedByUserId: 'admin_1' },
    })
    expect(result).toEqual({
      found: true,
      dismissedCount: 3,
      professionalId: 'pro_1',
      serviceId: 'svc_1',
    })
  })

  it('returns found:false and does not touch reports for an unknown look', async () => {
    const updateMany = vi.fn()
    const findUnique = vi.fn().mockResolvedValue(null)

    const result = await dismissLookPostReports(
      { lookPost: { findUnique }, lookPostReport: { updateMany } },
      { lookPostId: 'nope', adminUserId: 'admin_1' },
    )

    expect(result).toEqual({ found: false })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('is a forgiving no-op when nothing is unresolved (count 0)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const findUnique = vi.fn().mockResolvedValue({
      id: 'look_1',
      professionalId: 'pro_1',
      serviceId: null,
    })

    const result = await dismissLookPostReports(
      { lookPost: { findUnique }, lookPostReport: { updateMany } },
      { lookPostId: 'look_1', adminUserId: 'admin_1' },
    )

    expect(result).toEqual({
      found: true,
      dismissedCount: 0,
      professionalId: 'pro_1',
      serviceId: null,
    })
  })
})

describe('dismissLookCommentReports', () => {
  it('resolves unresolved comment reports and surfaces the parent look scope', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const findUnique = vi.fn().mockResolvedValue({
      id: 'comment_1',
      lookPost: { professionalId: 'pro_9', serviceId: null },
    })

    const result = await dismissLookCommentReports(
      { lookComment: { findUnique }, lookCommentReport: { updateMany } },
      { lookCommentId: 'comment_1', adminUserId: 'admin_1', now: NOW },
    )

    expect(updateMany).toHaveBeenCalledWith({
      where: { lookCommentId: 'comment_1', resolvedAt: null },
      data: { resolvedAt: NOW, resolvedByUserId: 'admin_1' },
    })
    expect(result).toEqual({
      found: true,
      dismissedCount: 1,
      professionalId: 'pro_9',
      serviceId: null,
    })
  })

  it('returns found:false for an unknown comment', async () => {
    const updateMany = vi.fn()
    const findUnique = vi.fn().mockResolvedValue(null)

    const result = await dismissLookCommentReports(
      { lookComment: { findUnique }, lookCommentReport: { updateMany } },
      { lookCommentId: 'nope', adminUserId: 'admin_1' },
    )

    expect(result).toEqual({ found: false })
    expect(updateMany).not.toHaveBeenCalled()
  })
})
