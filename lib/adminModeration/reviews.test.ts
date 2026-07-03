// lib/adminModeration/reviews.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reviewFindUnique: vi.fn(),
  reviewUpdate: vi.fn(),
  refreshProfessional: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    review: {
      findUnique: mocks.reviewFindUnique,
      update: mocks.reviewUpdate,
    },
  },
}))

vi.mock('@/lib/search/index/refreshSearchIndex', () => ({
  refreshProfessional: mocks.refreshProfessional,
}))

import {
  clearReviewProReplyByAdmin,
  hideReviewByAdmin,
  unhideReviewByAdmin,
} from './reviews'

const VISIBLE_REVIEW = {
  id: 'review_1',
  professionalId: 'pro_1',
  hiddenAt: null,
  proReplyBody: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.reviewFindUnique.mockResolvedValue(VISIBLE_REVIEW)
  mocks.reviewUpdate.mockResolvedValue({})
  mocks.refreshProfessional.mockResolvedValue(undefined)
})

describe('hideReviewByAdmin', () => {
  it('hides a visible review and refreshes the search-index rollup', async () => {
    const result = await hideReviewByAdmin({
      reviewId: 'review_1',
      adminUserId: 'admin_1',
      reason: 'Harassment',
    })

    expect(result).toMatchObject({
      found: true,
      alreadyHidden: false,
      professionalId: 'pro_1',
    })
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: 'review_1' },
      data: {
        hiddenAt: expect.any(Date),
        hiddenByAdminUserId: 'admin_1',
        hiddenReason: 'Harassment',
      },
    })
    expect(mocks.refreshProfessional).toHaveBeenCalledWith(
      'pro_1',
      'review.moderation',
    )
  })

  it('is a no-op on an already-hidden review', async () => {
    mocks.reviewFindUnique.mockResolvedValue({
      ...VISIBLE_REVIEW,
      hiddenAt: new Date('2026-07-01T00:00:00Z'),
    })

    const result = await hideReviewByAdmin({
      reviewId: 'review_1',
      adminUserId: 'admin_1',
      reason: null,
    })

    expect(result).toMatchObject({ found: true, alreadyHidden: true })
    expect(mocks.reviewUpdate).not.toHaveBeenCalled()
    expect(mocks.refreshProfessional).not.toHaveBeenCalled()
  })

  it('reports a missing review', async () => {
    mocks.reviewFindUnique.mockResolvedValue(null)

    const result = await hideReviewByAdmin({
      reviewId: 'review_x',
      adminUserId: 'admin_1',
      reason: null,
    })

    expect(result).toEqual({ found: false })
    expect(mocks.reviewUpdate).not.toHaveBeenCalled()
  })
})

describe('unhideReviewByAdmin', () => {
  it('clears all three moderation columns and refreshes the rollup', async () => {
    mocks.reviewFindUnique.mockResolvedValue({
      ...VISIBLE_REVIEW,
      hiddenAt: new Date('2026-07-01T00:00:00Z'),
    })

    const result = await unhideReviewByAdmin({ reviewId: 'review_1' })

    expect(result).toMatchObject({
      found: true,
      wasHidden: true,
      professionalId: 'pro_1',
    })
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: 'review_1' },
      data: {
        hiddenAt: null,
        hiddenByAdminUserId: null,
        hiddenReason: null,
      },
    })
    expect(mocks.refreshProfessional).toHaveBeenCalledWith(
      'pro_1',
      'review.moderation',
    )
  })

  it('is a no-op on a review that is not hidden', async () => {
    const result = await unhideReviewByAdmin({ reviewId: 'review_1' })

    expect(result).toMatchObject({ found: true, wasHidden: false })
    expect(mocks.reviewUpdate).not.toHaveBeenCalled()
    expect(mocks.refreshProfessional).not.toHaveBeenCalled()
  })

  it('reports a missing review', async () => {
    mocks.reviewFindUnique.mockResolvedValue(null)

    expect(await unhideReviewByAdmin({ reviewId: 'review_x' })).toEqual({
      found: false,
    })
  })
})

describe('clearReviewProReplyByAdmin', () => {
  it('clears the reply columns without touching rating rollups', async () => {
    mocks.reviewFindUnique.mockResolvedValue({
      ...VISIBLE_REVIEW,
      proReplyBody: 'Rude reply',
    })

    const result = await clearReviewProReplyByAdmin({ reviewId: 'review_1' })

    expect(result).toMatchObject({
      found: true,
      hadReply: true,
      professionalId: 'pro_1',
    })
    expect(mocks.reviewUpdate).toHaveBeenCalledWith({
      where: { id: 'review_1' },
      data: { proReplyBody: null, proReplyAt: null },
    })
    expect(mocks.refreshProfessional).not.toHaveBeenCalled()
  })

  it('is a no-op when there is no reply', async () => {
    const result = await clearReviewProReplyByAdmin({ reviewId: 'review_1' })

    expect(result).toMatchObject({ found: true, hadReply: false })
    expect(mocks.reviewUpdate).not.toHaveBeenCalled()
  })

  it('reports a missing review', async () => {
    mocks.reviewFindUnique.mockResolvedValue(null)

    expect(await clearReviewProReplyByAdmin({ reviewId: 'review_x' })).toEqual({
      found: false,
    })
  })
})
