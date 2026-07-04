import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lookFindMany: vi.fn(),
  commentFindMany: vi.fn(),
  renderMediaUrls: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lookPost: { findMany: mocks.lookFindMany },
    lookComment: { findMany: mocks.commentFindMany },
  },
}))

vi.mock('@/lib/tenant', () => ({
  platformCrossTenantProVisibilityFilter: () => ({}),
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

import {
  isAdminLookModerationStatusFilter,
  listAdminLookCommentModeration,
  listAdminLookModeration,
} from './adminLookModeration'

const CREATED = new Date('2026-07-04T12:00:00Z')

function proRow() {
  return {
    id: 'look_pro',
    caption: 'Balayage',
    clientAuthorId: null,
    status: 'PUBLISHED',
    moderationStatus: 'APPROVED',
    createdAt: CREATED,
    publishedAt: CREATED,
    featuredAt: new Date('2026-07-03T00:00:00Z'),
    adminNotes: null,
    reviewedAt: null,
    likeCount: 5,
    commentCount: 2,
    saveCount: 1,
    shareCount: 0,
    viewCount: 40,
    primaryMediaAsset: { mediaType: 'IMAGE', url: null, thumbUrl: null },
    professional: {
      id: 'pro_1',
      businessName: 'Glow Studio',
      firstName: 'Amy',
      lastName: 'Lee',
      handle: 'glow',
    },
    clientAuthor: null,
    _count: { reports: 2 },
    reports: [{ reason: 'SPAM' }, { reason: 'SPAM' }, { reason: 'OTHER' }],
  }
}

function clientRow() {
  return {
    ...proRow(),
    id: 'look_client',
    clientAuthorId: 'client_1',
    caption: 'My fresh cut',
    featuredAt: null,
    clientAuthor: { firstName: 'Jordan', lastName: 'Rivera' },
    _count: { reports: 0 },
    reports: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.renderMediaUrls.mockResolvedValue({
    renderThumbUrl: 'thumb://x',
    renderUrl: null,
  })
})

describe('isAdminLookModerationStatusFilter', () => {
  it('accepts known filters and rejects junk', () => {
    expect(isAdminLookModerationStatusFilter('REPORTED')).toBe(true)
    expect(isAdminLookModerationStatusFilter('ALL')).toBe(true)
    expect(isAdminLookModerationStatusFilter('nonsense')).toBe(false)
    expect(isAdminLookModerationStatusFilter(null)).toBe(false)
  })
})

describe('listAdminLookModeration', () => {
  it('filters REPORTED by unresolved reports, cross-tenant, newest first', async () => {
    mocks.lookFindMany.mockResolvedValue([proRow()])

    await listAdminLookModeration({ status: 'REPORTED' })

    const args = mocks.lookFindMany.mock.calls[0]![0]
    expect(args.where).toEqual({
      professional: {},
      reports: { some: { resolvedAt: null } },
    })
    expect(args.orderBy).toEqual({ createdAt: 'desc' })
    expect(args.take).toBe(50)
  })

  it('filters PENDING by moderationStatus and applies a pro search', async () => {
    mocks.lookFindMany.mockResolvedValue([])

    await listAdminLookModeration({ status: 'PENDING', q: 'glow' })

    const args = mocks.lookFindMany.mock.calls[0]![0]
    expect(args.where.moderationStatus).toBe('PENDING_REVIEW')
    expect(args.where.professional.OR).toEqual([
      { businessName: { contains: 'glow', mode: 'insensitive' } },
      { handle: { contains: 'glow', mode: 'insensitive' } },
      { firstName: { contains: 'glow', mode: 'insensitive' } },
      { lastName: { contains: 'glow', mode: 'insensitive' } },
    ])
  })

  it('maps a pro-authored look with distinct reasons + featured flag', async () => {
    mocks.lookFindMany.mockResolvedValue([proRow()])

    const [row] = await listAdminLookModeration({ status: 'REPORTED' })

    expect(row).toMatchObject({
      lookPostId: 'look_pro',
      authorKind: 'PRO',
      authorLabel: 'Glow Studio',
      proLabel: 'Glow Studio',
      proHandle: 'glow',
      thumbUrl: 'thumb://x',
      reportCount: 2,
      reportReasons: ['SPAM', 'OTHER'],
      featured: true,
    })
  })

  it('maps a client-authored look to the client label (prerequisite for C2)', async () => {
    mocks.lookFindMany.mockResolvedValue([clientRow()])

    const [row] = await listAdminLookModeration({ status: 'ALL' })

    expect(row).toMatchObject({
      lookPostId: 'look_client',
      authorKind: 'CLIENT',
      authorLabel: 'Jordan Rivera',
      featured: false,
      reportCount: 0,
    })
  })
})

describe('listAdminLookCommentModeration', () => {
  it('scopes across tenants through the parent look and maps the commenter', async () => {
    mocks.commentFindMany.mockResolvedValue([
      {
        id: 'comment_1',
        lookPostId: 'look_pro',
        body: 'love this',
        createdAt: CREATED,
        moderationStatus: 'APPROVED',
        removedAt: null,
        adminNotes: null,
        reviewedAt: null,
        user: {
          clientProfile: { firstName: 'Sam', lastName: 'Doe' },
          professionalProfile: null,
        },
        lookPost: {
          professional: {
            id: 'pro_1',
            businessName: 'Glow Studio',
            firstName: null,
            lastName: null,
            handle: 'glow',
          },
        },
        _count: { reports: 1 },
        reports: [{ reason: 'HATE_OR_HARASSMENT' }],
      },
    ])

    const [row] = await listAdminLookCommentModeration({ status: 'REPORTED' })

    const args = mocks.commentFindMany.mock.calls[0]![0]
    expect(args.where).toEqual({
      lookPost: { professional: {} },
      reports: { some: { resolvedAt: null } },
    })
    expect(row).toMatchObject({
      lookCommentId: 'comment_1',
      lookPostId: 'look_pro',
      authorLabel: 'Sam Doe',
      proLabel: 'Glow Studio',
      reportCount: 1,
      reportReasons: ['HATE_OR_HARASSMENT'],
    })
  })
})
