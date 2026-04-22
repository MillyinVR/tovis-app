import { describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  VerificationStatus,
} from '@prisma/client'

import {
  buildLookPostSearchDocument,
  isLookPostSearchEligible,
  processIndexLookPostDocument,
  type IndexLookPostDocumentDb,
} from './indexLookPostDocument'

type TestProfessionalRow = {
  id: string
  businessName: string | null
  handle: string | null
  verificationStatus: VerificationStatus
}

type TestServiceCategoryRow = {
  id: string
  name: string
  slug: string
}

type TestServiceRow = {
  id: string
  name: string
  category: TestServiceCategoryRow
}

type TestLookPostRow = {
  id: string
  professionalId: string
  serviceId: string | null
  caption: string | null

  status: LookPostStatus
  visibility: LookPostVisibility
  moderationStatus: ModerationStatus

  publishedAt: Date | null
  archivedAt: Date | null
  removedAt: Date | null

  likeCount: number
  commentCount: number
  saveCount: number
  shareCount: number

  spotlightScore: number
  rankScore: number

  createdAt: Date
  updatedAt: Date

  professional: TestProfessionalRow
  service: TestServiceRow | null
}

function makeLookPostRow(
  overrides?: Partial<TestLookPostRow>,
): TestLookPostRow {
  return {
    id: overrides?.id ?? 'look_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    serviceId:
      overrides && 'serviceId' in overrides ? overrides.serviceId! : 'svc_1',
    caption:
      overrides && 'caption' in overrides
        ? overrides.caption!
        : '  Soft glam   bob   ',

    status: overrides?.status ?? LookPostStatus.PUBLISHED,
    visibility: overrides?.visibility ?? LookPostVisibility.PUBLIC,
    moderationStatus:
      overrides?.moderationStatus ?? ModerationStatus.APPROVED,

    publishedAt:
      overrides && 'publishedAt' in overrides
        ? overrides.publishedAt!
        : new Date('2026-04-21T12:00:00.000Z'),
    archivedAt:
      overrides && 'archivedAt' in overrides ? overrides.archivedAt! : null,
    removedAt:
      overrides && 'removedAt' in overrides ? overrides.removedAt! : null,

    likeCount: overrides?.likeCount ?? 12,
    commentCount: overrides?.commentCount ?? 3,
    saveCount: overrides?.saveCount ?? 5,
    shareCount: overrides?.shareCount ?? 1,

    spotlightScore: overrides?.spotlightScore ?? 44,
    rankScore: overrides?.rankScore ?? 38,

    createdAt:
      overrides?.createdAt ?? new Date('2026-04-20T10:00:00.000Z'),
    updatedAt:
      overrides?.updatedAt ?? new Date('2026-04-21T13:00:00.000Z'),

    professional: overrides?.professional ?? {
      id: 'pro_1',
      businessName: '  TOVIS Studio  ',
      handle: '  tovisstudio  ',
      verificationStatus: VerificationStatus.APPROVED,
    },

    service:
      overrides && 'service' in overrides
        ? overrides.service!
        : {
            id: 'svc_1',
            name: '  Bob Cut  ',
            category: {
              id: 'cat_1',
              name: '  Hair  ',
              slug: '  hair  ',
            },
          },
  }
}

function makeDb() {
  const findUnique = vi.fn()

  const db = {
    lookPost: {
      findUnique,
    },
  } as unknown as IndexLookPostDocumentDb

  return {
    db,
    findUnique,
  }
}

describe('lib/jobs/looksSocial/indexLookPostDocument.ts', () => {
  describe('isLookPostSearchEligible', () => {
    it('returns true for a published public approved look from a publicly approved pro', () => {
      const row = makeLookPostRow()

      expect(isLookPostSearchEligible(row)).toBe(true)
    })

    it('returns false when visibility is not public', () => {
      const row = makeLookPostRow({
        visibility: LookPostVisibility.FOLLOWERS_ONLY,
      })

      expect(isLookPostSearchEligible(row)).toBe(false)
    })

    it('returns false when the look has been removed', () => {
      const row = makeLookPostRow({
        removedAt: new Date('2026-04-21T14:00:00.000Z'),
      })

      expect(isLookPostSearchEligible(row)).toBe(false)
    })

    it('returns false when the professional is not publicly approved', () => {
      const row = makeLookPostRow({
        professional: {
          id: 'pro_1',
          businessName: 'TOVIS Studio',
          handle: 'tovisstudio',
          verificationStatus: VerificationStatus.PENDING,
        },
      })

      expect(isLookPostSearchEligible(row)).toBe(false)
    })
  })

  describe('buildLookPostSearchDocument', () => {
    it('builds a normalized search document from the canonical look row', () => {
      const row = makeLookPostRow()

      const result = buildLookPostSearchDocument(row)

      expect(result).toEqual({
        id: 'look_1',
        lookPostId: 'look_1',

        professionalId: 'pro_1',
        professionalBusinessName: 'TOVIS Studio',
        professionalHandle: 'tovisstudio',
        professionalVerificationStatus: VerificationStatus.APPROVED,

        serviceId: 'svc_1',
        serviceName: 'Bob Cut',
        serviceCategoryId: 'cat_1',
        serviceCategoryName: 'Hair',
        serviceCategorySlug: 'hair',

        caption: 'Soft glam bob',

        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.PUBLIC,
        moderationStatus: ModerationStatus.APPROVED,

        publishedAt: '2026-04-21T12:00:00.000Z',
        archivedAt: null,
        removedAt: null,
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-21T13:00:00.000Z',

        likeCount: 12,
        commentCount: 3,
        saveCount: 5,
        shareCount: 1,
        spotlightScore: 44,
        rankScore: 38,

        searchTerms: [
          'soft glam bob',
          'tovis studio',
          'tovisstudio',
          'bob cut',
          'hair',
        ],
        searchText:
          'soft glam bob tovis studio tovisstudio bob cut hair',
      })
    })

    it('deduplicates repeated normalized search terms', () => {
      const row = makeLookPostRow({
        caption: '  Hair  ',
        service: {
          id: 'svc_1',
          name: ' hair ',
          category: {
            id: 'cat_1',
            name: ' HAIR ',
            slug: ' hair ',
          },
        },
      })

      const result = buildLookPostSearchDocument(row)

      expect(result.searchTerms).toEqual([
        'hair',
        'tovis studio',
        'tovisstudio',
      ])
      expect(result.searchText).toBe(
        'hair tovis studio tovisstudio',
      )
    })

    it('throws when publishedAt is missing', () => {
      const row = makeLookPostRow({
        publishedAt: null,
      })

      expect(() => buildLookPostSearchDocument(row)).toThrow(
        'Cannot build look post search document without publishedAt.',
      )
    })

    it('handles a missing service relation cleanly', () => {
      const row = makeLookPostRow({
        serviceId: null,
        service: null,
      })

      const result = buildLookPostSearchDocument(row)

      expect(result.serviceId).toBe(null)
      expect(result.serviceName).toBe(null)
      expect(result.serviceCategoryId).toBe(null)
      expect(result.serviceCategoryName).toBe(null)
      expect(result.serviceCategorySlug).toBe(null)
    })
  })

  describe('processIndexLookPostDocument', () => {
    it('returns DELETE when the look post no longer exists', async () => {
      const { db, findUnique } = makeDb()
      findUnique.mockResolvedValue(null)

      const result = await processIndexLookPostDocument(db, {
        lookPostId: 'look_missing',
      })

      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'look_missing' },
        }),
      )

      expect(result).toEqual({
        action: 'DELETE',
        lookPostId: 'look_missing',
        reason: 'LOOK_POST_NOT_FOUND',
        document: null,
      })
    })

    it('returns DELETE when the look exists but is not searchable', async () => {
      const { db, findUnique } = makeDb()
      findUnique.mockResolvedValue(
        makeLookPostRow({
          visibility: LookPostVisibility.UNLISTED,
        }),
      )

      const result = await processIndexLookPostDocument(db, {
        lookPostId: 'look_1',
      })

      expect(result).toEqual({
        action: 'DELETE',
        lookPostId: 'look_1',
        reason: 'LOOK_POST_NOT_SEARCHABLE',
        document: null,
      })
    })

    it('returns UPSERT with the normalized document when the look is searchable', async () => {
      const { db, findUnique } = makeDb()
      findUnique.mockResolvedValue(makeLookPostRow())

      const result = await processIndexLookPostDocument(db, {
        lookPostId: 'look_1',
      })

      expect(result.action).toBe('UPSERT')
      expect(result.lookPostId).toBe('look_1')
      expect(result.reason).toBe('LOOK_POST_SEARCHABLE')

      if (result.action !== 'UPSERT') {
        throw new Error('expected UPSERT outcome')
      }

      expect(result.document).toMatchObject({
        id: 'look_1',
        lookPostId: 'look_1',
        professionalId: 'pro_1',
        professionalBusinessName: 'TOVIS Studio',
        professionalHandle: 'tovisstudio',
        serviceId: 'svc_1',
        serviceName: 'Bob Cut',
        serviceCategoryId: 'cat_1',
        serviceCategoryName: 'Hair',
        serviceCategorySlug: 'hair',
        caption: 'Soft glam bob',
        status: LookPostStatus.PUBLISHED,
        visibility: LookPostVisibility.PUBLIC,
        moderationStatus: ModerationStatus.APPROVED,
      })

      expect(result.document.searchTerms).toEqual([
        'soft glam bob',
        'tovis studio',
        'tovisstudio',
        'bob cut',
        'hair',
      ])
    })

    it('rejects a blank lookPostId', async () => {
      const { db } = makeDb()

      await expect(
        processIndexLookPostDocument(db, {
          lookPostId: '   ',
        }),
      ).rejects.toThrow('lookPostId is required.')
    })
  })
})