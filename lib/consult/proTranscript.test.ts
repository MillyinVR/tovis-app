import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const db = {
    $queryRaw: vi.fn(), consultRevision: { findMany: vi.fn() },
    consultInspiration: { findMany: vi.fn() }, consultCapture: { findMany: vi.fn() },
    consultFollowUpRound: { findMany: vi.fn() }, consultLookBriefVersion: { findMany: vi.fn() },
  }
  return { db, authorize: vi.fn(), transaction: (operation: (tx: typeof db) => Promise<unknown>) => operation(db) }
})
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock('./lookBrief', () => ({ requireAuthorizedProLookScope: mocks.authorize }))
import { loadProConsultTranscript, transcriptCursor } from './proTranscript'

const args = { consultSessionId: 'consult-1', professionalId: 'pro-1', actorUserId: 'user-1' }
const createdAt = new Date('2026-09-10T10:00:00.000Z')
beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({ id: 'consult-1' })
  mocks.db.$queryRaw.mockResolvedValue([])
  for (const model of [mocks.db.consultRevision, mocks.db.consultInspiration, mocks.db.consultCapture, mocks.db.consultFollowUpRound, mocks.db.consultLookBriefVersion]) model.findMany.mockResolvedValue([])
})

it('requires the shared pro and consent guard before any event or payload query', async () => {
  mocks.authorize.mockRejectedValueOnce(new Error('denied'))
  await expect(loadProConsultTranscript(args)).rejects.toThrow('denied')
  expect(mocks.db.$queryRaw).not.toHaveBeenCalled()
  expect(mocks.db.consultRevision.findMany).not.toHaveBeenCalled()
  expect(mocks.authorize).toHaveBeenCalledWith(mocks.db, args, { readOnly: true })
})

it('only exposes stored question text and selected option labels, never evidence or extra provider fields', async () => {
  mocks.db.$queryRaw.mockResolvedValue([{ id: 'round1', source: 'FOLLOW_UP', createdAt }])
  mocks.db.consultFollowUpRound.findMany.mockResolvedValue([{ id: 'round1',
    questions: [{ key: 'history', text: 'Have you used color?', home: 'FOLLOW_UP', evidence: 'PRIVATE_EVIDENCE',
      reasoning: 'PRIVATE_REASONING', options: [{ value: 'no', label: 'No' }, { value: 'unknown', label: 'Not sure' }] }],
    answers: { history: ['unknown'], secret: ['PRIVATE_ANSWER'] }, storagePath: 'PRIVATE_PATH' }])
  const result = await loadProConsultTranscript(args)
  expect(result.events[0]?.items).toEqual([{ label: 'Have you used color?', value: 'Not sure' }])
  expect(JSON.stringify(result)).not.toContain('PRIVATE_')
})

it('keeps unreadable revision markers instead of spreading stored payloads', async () => {
  mocks.db.$queryRaw.mockResolvedValue([{ id: 'r1', source: 'REVISION', createdAt }])
  mocks.db.consultRevision.findMany.mockResolvedValue([{ id: 'r1', consultSessionId: 'consult-1',
    revision: 1, kind: 'INTAKE', schemaVersion: 999, createdAt, payload: { raw: 'PRIVATE_PAYLOAD' } }])
  const result = await loadProConsultTranscript(args)
  expect(result.events[0]?.unavailable).toBe(true)
  expect(JSON.stringify(result)).not.toContain('PRIVATE_PAYLOAD')
})

it('reads payloads for one bounded page and emits a deterministic continuation cursor', async () => {
  mocks.db.$queryRaw.mockResolvedValue(Array.from({ length: 41 }, (_, n) => ({ id: `r${n}`, source: 'REVISION', createdAt })))
  const result = await loadProConsultTranscript(args)
  expect(result.events).toHaveLength(40)
  expect(transcriptCursor(result.nextCursor)).toEqual({ id: 'r39', source: 'REVISION', createdAt: createdAt.toISOString() })
  expect(mocks.db.consultRevision.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { consultSessionId: 'consult-1', id: { in: Array.from({ length: 40 }, (_, n) => `r${n}`) } },
  }))
})

it('rejects malformed cursors without querying', async () => {
  for (const cursor of ['not-json', 'x'.repeat(513), Buffer.from(JSON.stringify({ id: 'x', source: 'RAW', createdAt: createdAt.toISOString() })).toString('base64url')]) {
    await expect(loadProConsultTranscript({ ...args, cursor })).rejects.toThrow('Invalid history cursor')
  }
  expect(mocks.authorize).not.toHaveBeenCalled()
})
