import {
  BookingStatus,
  ConsultActorType,
  Prisma,
  PrismaClient,
  ServiceLocationType,
} from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

const mockRequireClient = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

vi.mock('@/lib/consult/access', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/consult/access')>()
  return {
    ...original,
    isAiConsultC6ExposureEnabledForPro: () => true,
    isAiConsultC7ExposureEnabledForPro: () => true,
  }
})

vi.mock('@/lib/consult/captureStorage', async () => {
  const fakes = await import('./_support/consultLookFakes')
  return fakes.buildFakeCaptureStorageModule()
})

vi.mock('@/lib/consult/captureVision', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/captureVision')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, checkConsultCapture: fakes.fakeCheckConsultCapture }
})

vi.mock('@/lib/consult/inspirationImage', async () => {
  const fakes = await import('./_support/consultLookFakes')
  return { fetchConsultInspirationImage: fakes.fakeFetchConsultInspirationImage }
})

vi.mock('@/lib/consult/inspirationVision', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/inspirationVision')>()
  const fakes = await import('./_support/consultLookFakes')
  return {
    ...original,
    runConsultInspirationVision: fakes.fakeRunConsultInspirationVision,
  }
})

vi.mock('@/lib/consult/analysisEngine', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/analysisEngine')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, runConsultAnalysis: fakes.fakeRunConsultAnalysis }
})


import { consultCaptureStorage } from '@/lib/consult/captureStorage'
import { deleteClientConsultSession, loadClientConsultSessions } from '@/lib/consult/clientSessions'
import { startLookAnchoredConsult } from '@/lib/consult/lookConsultEntry'
import { prepareClientConsultDeletion, finishClientConsultDeletion } from '@/lib/consult/writeBoundary'
import { purgeConsultSessionRawObjects } from '@/lib/consult/capturePurge'
import { resetConsultLookFakes } from './_support/consultLookFakes'
import { createLook, fx, runConsultToCompletion, seedLookConsultFixture, teardownLookConsultFixture, ZONE, BALAYAGE_PRICE } from './_support/lookConsultFixture'

const db = new PrismaClient()
const ids: string[] = []
beforeAll(async () => { await seedLookConsultFixture(db, { tagPrefix: 'consult_delete' }) })
beforeEach(() => {
  vi.clearAllMocks(); resetConsultLookFakes()
  mockRequireClient.mockResolvedValue({ ok: true, clientId: fx.clientId, user: { id: fx.clientUserId } })
})
afterAll(async () => {
  await teardownLookConsultFixture(db, async () => {
    for (const id of ids) {
      await purgeConsultSessionRawObjects(id)
      await db.consultSession.deleteMany({ where: { id } })
    }
  })
  await db.$disconnect()
})
const scope = (id: string) => ({ consultSessionId: id, clientId: fx.clientId, actorUserId: fx.clientUserId })
const actorScope = (id: string) => ({ ...scope(id), actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId } })
async function start() {
  const lookPostId = await createLook(db, fx.balayageServiceId)
  const consult = await startLookAnchoredConsult({ lookPostId, clientId: fx.clientId, actorUserId: fx.clientUserId })
  ids.push(consult.id)
  return { id: consult.id, lookPostId }
}

describe('client Home consult deletion', () => {
  it('lists only owned drafts, deletes their answers, and starts the same look fresh', async () => {
    const { id, lookPostId } = await start()
    expect((await loadClientConsultSessions(fx.clientId)).consultations.some(row => row.id === id)).toBe(true)
    expect((await loadClientConsultSessions('another-client')).consultations).toEqual([])
    await deleteClientConsultSession(scope(id))
    expect(await db.consultSession.findUnique({ where: { id } })).toBeNull()
    expect(await db.consultRevision.count({ where: { consultSessionId: id } })).toBe(0)
    const fresh = await startLookAnchoredConsult({ lookPostId, clientId: fx.clientId, actorUserId: fx.clientUserId })
    ids.push(fresh.id)
    expect(fresh.id).not.toBe(id)
    expect(fresh.status).toBe('CONSENT_REQUIRED')
  })
  it('rejects another client before stopping or cleaning up the consult', async () => {
    const { id } = await start()
    await expect(deleteClientConsultSession({ ...scope(id), actorUserId: fx.proUserId })).rejects.toMatchObject({ code: 'NOT_OWNER' })
    expect((await db.consultSession.findUniqueOrThrow({ where: { id } })).status).toBe('CONSENT_REQUIRED')
  })
  it('deletes a completed unbooked analysis after verified raw-photo cleanup', async () => {
    const look = await createLook(db, fx.balayageServiceId)
    const id = await runConsultToCompletion(db, look, 'delete-completed')
    await deleteClientConsultSession(scope(id))
    expect(await db.consultSession.findUnique({ where: { id } })).toBeNull()
    expect(await db.consultCapture.count({ where: { consultSessionId: id } })).toBe(0)
  })
  it('keeps storage pointers when deletion is attempted before cleanup, then allows a retry', async () => {
    const look = await createLook(db, fx.balayageServiceId)
    const id = await runConsultToCompletion(db, look, 'delete-retry')
    await prepareClientConsultDeletion(actorScope(id))
    await expect(finishClientConsultDeletion(actorScope(id))).rejects.toBeDefined()
    expect(await db.consultSession.findUnique({ where: { id } })).not.toBeNull()
    expect((await loadClientConsultSessions(fx.clientId)).consultations.find(row => row.id === id)?.canResume).toBe(false)
    await deleteClientConsultSession(scope(id))
    expect(await db.consultSession.findUnique({ where: { id } })).toBeNull()
  })
  it('does not claim deletion when storage is unavailable, and a retry completes it', async () => {
    const look = await createLook(db, fx.balayageServiceId)
    const id = await runConsultToCompletion(db, look, 'delete-storage-failure')
    const failure = vi.spyOn(consultCaptureStorage, 'purgeObject').mockRejectedValueOnce(new Error('synthetic storage outage'))
    try {
      await expect(deleteClientConsultSession(scope(id))).rejects.toMatchObject({ code: 'CAPTURE_STORAGE_UNAVAILABLE' })
      expect((await db.consultSession.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED')
      expect(await db.consultCapture.count({ where: { consultSessionId: id, purgedAt: null } })).toBeGreaterThan(0)
    } finally { failure.mockRestore() }
    await deleteClientConsultSession(scope(id))
    expect(await db.consultSession.findUnique({ where: { id } })).toBeNull()
  })
  it('can reach older consultations even after the page cursor consultation is deleted', async () => {
    const created: string[] = []
    for (let i = 0; i < 22; i += 1) created.push((await start()).id)
    const first = await loadClientConsultSessions(fx.clientId)
    expect(first.consultations).toHaveLength(20)
    expect(first.nextCursor).not.toBeNull()
    const cursor = first.nextCursor!
    await deleteClientConsultSession(scope(cursor))
    const second = await loadClientConsultSessions(fx.clientId, cursor)
    const combined = [...first.consultations, ...second.consultations].map(item => item.id)
    expect(new Set(combined).size).toBe(combined.length)
    for (const id of created) expect(combined).toContain(id)
  })
  it('protects even an old completed appointment resolved through the legacy look link', async () => {
    const { id, lookPostId } = await start()
    const booking = await db.booking.create({ data: {
      clientId: fx.clientId, professionalId: fx.professionalId, serviceId: fx.balayageServiceId,
      offeringId: fx.balayageOfferingId, status: BookingStatus.COMPLETED, sourceLookPostId: lookPostId,
      scheduledFor: new Date(Date.now() + 86400000), locationType: ServiceLocationType.SALON,
      locationId: fx.locationId, locationTimeZone: ZONE, subtotalSnapshot: new Prisma.Decimal(BALAYAGE_PRICE),
      totalAmount: new Prisma.Decimal(BALAYAGE_PRICE), totalDurationMinutes: 60,
      proTenantId: fx.tenantId, clientHomeTenantId: fx.tenantId,
    } })
    try {
      expect((await loadClientConsultSessions(fx.clientId)).consultations.some(row => row.id === id)).toBe(false)
      await expect(deleteClientConsultSession(scope(id))).rejects.toMatchObject({ code: 'INVALID_STATE' })
      expect(await db.booking.findUnique({ where: { id: booking.id } })).not.toBeNull()
    } finally { await db.booking.delete({ where: { id: booking.id } }) }
  })
})
