import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient, type ConsultRevision, type Prisma } from '@prisma/client'
import { describeLookRefinement } from './lookRefinementDiff'

const db = new PrismaClient()
afterEach(() => vi.restoreAllMocks())
afterAll(() => db.$disconnect())
const beforeTime = new Date('2026-09-08T10:00:00Z')
const afterTime = new Date('2026-09-08T10:01:00Z')
const reference = (favorite: string): Prisma.JsonObject => ({
  packId: 'hair-color-inspiration', packVersion: 1, schemaVersion: 2,
  source: 'PLATFORM_LOOK', inspirationId: 'image-1', complete: false,
  answers: { favorite_colors: [favorite] }, catalogGuidance: [],
})
const revision = (number: number, payload: Prisma.JsonObject): ConsultRevision => ({
  id: `revision-${number}`, consultSessionId: 'consult', revision: number,
  kind: 'INSPIRATION', payload, schemaVersion: 2, model: null, promptVersion: null,
  idempotencyKey: null, requestHash: null, createdAt: afterTime,
})
const question = (answer: string) => ({ questionKey: 'history', question: 'Client follow-up: Color history', answer })

describe('the consented look refinement diff', () => {
  it('shows changed client words and removed answers without repeating unchanged answers', async () => {
    vi.spyOn(db.consultRevision, 'findMany').mockResolvedValue([])
    expect(await describeLookRefinement(db, {
      consultSessionId: 'consult', previousCreatedAt: beforeTime,
      previousAnswers: [question('No previous color'), { questionKey: 'keep', question: 'Keep', answer: 'Length' }],
      answers: [question('Box color last month')],
    })).toEqual(['Keep: “Length” is no longer selected.', 'Color history: “No previous color” → “Box color last month”.'])
    expect(await describeLookRefinement(db, {
      consultSessionId: 'consult', previousCreatedAt: beforeTime,
      previousAnswers: [question('Box color last month')], answers: [question('Box color last month')],
    })).toEqual([])
  })
  it('compares the visual preference labels and does not repeat changes older than the prior brief', async () => {
    vi.spyOn(db.consultRevision, 'findMany')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([revision(2, reference('cool-smoky')), revision(1, reference('warm-golden'))])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([revision(2, reference('cool-smoky')), revision(1, reference('warm-golden'))])
    const args = { consultSessionId: 'consult', previousCreatedAt: beforeTime, previousAnswers: [], answers: [] }
    const changes = await describeLookRefinement(db, args)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatch(/Likes:.*warm.*→.*cool/i)
    expect(await describeLookRefinement(db, { ...args, previousCreatedAt: afterTime })).toEqual([])
  })
})
