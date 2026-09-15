import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { Prisma, Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { enqueueLookMediaAnalyses } from '@/lib/looks/analysis/queue'
import { processNextLookAnalysis } from '@/lib/looks/analysis/process'
import { listLookAnalyses, mutateLookAnalysis } from '@/lib/looks/analysis/review'
import { loadReusableLookAnalysis } from '@/lib/looks/analysis/cache'
import { LOOK_ANALYSIS_ASSET_SELECT } from '@/lib/looks/analysis/identity'
import { readAnalysis } from '@/lib/looks/analysis/reading'
import { performConsultInspirationRead } from '@/lib/consult/inspirationAnalysisContract'
import { hairMapFixture } from '@/test/fixtures/consultHairMap'
vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({ kickNotificationDrain: vi.fn() }))

const tag = `look-analysis-${randomUUID()}`
let adminId: string
let proId: string, userId: string, mediaId: string, lookId: string, tenantId: string, serviceId: string, categoryId: string
const analysis = readAnalysis(Object.fromEntries(Object.entries({ baseLevel: 'LEVEL_5', lightestLevel: 'LEVEL_8', tone: 'UNKNOWN', technique: 'BALAYAGE', placement: 'MIDS_TO_ENDS', rootBlend: 'SHADOW_ROOT', finish: 'HIGH_SHINE', dimension: 'MEDIUM' }).map(([key, value]) => [key, { value, confidence: value === 'UNKNOWN' ? { min: 0, max: 0.35 } : { min: 0.7, max: 0.9 }, evidence: value === 'UNKNOWN' ? [] : ['inspiration'], region: value === 'UNKNOWN' ? null : '0.1,0.1,0.5,0.5' }])))

beforeAll(async () => {
  vi.stubEnv('AI_LOOK_UPLOAD_ANALYSIS_ENABLED', 'true')
  adminId = (await prisma.user.create({ data: { email: `${tag}-admin@example.test`, password: 'test-only', role: Role.ADMIN, adminPermissions: { create: { role: 'SUPER_ADMIN' } } } })).id
  tenantId = (await prisma.tenant.create({ data: { slug: tag, name: tag } })).id
  userId = (await prisma.user.create({ data: { email: `${tag}@example.test`, password: 'test-only', role: Role.PRO } })).id
  proId = (await prisma.professionalProfile.create({ data: { userId, homeTenantId: tenantId, firstName: 'Test', lastName: 'Pro', timeZone: 'America/Los_Angeles' } })).id
  categoryId = (await prisma.serviceCategory.create({ data: { name: tag, slug: tag, consultFamily: 'HAIR' } })).id
  serviceId = (await prisma.service.create({ data: { name: tag, categoryId, defaultDurationMinutes: 60, minPrice: new Prisma.Decimal(100) } })).id
  mediaId = (await prisma.mediaAsset.create({ data: { professionalId: proId, proTenantId: tenantId, primaryServiceId: serviceId, mediaType: 'IMAGE', storageBucket: 'media-public', storagePath: `${tag}.jpg` } })).id
  lookId = (await prisma.lookPost.create({ data: { professionalId: proId, primaryMediaAssetId: mediaId, serviceId, status: 'PUBLISHED', visibility: 'PUBLIC', moderationStatus: 'APPROVED', publishedAt: new Date() } })).id
})
afterAll(async () => {
  if (lookId) await prisma.lookPost.deleteMany({ where: { id: lookId } })
  if (mediaId) await prisma.mediaAsset.deleteMany({ where: { id: mediaId } })
  if (proId) { await prisma.notification.deleteMany({ where: { professionalId: proId } }); await prisma.professionalProfile.deleteMany({ where: { id: proId } }) }
  if (adminId) { await prisma.adminPermission.deleteMany({ where: { adminUserId: adminId } }); await prisma.user.deleteMany({ where: { id: adminId } }) }
  if (userId) await prisma.user.deleteMany({ where: { id: userId } })
  if (serviceId) await prisma.service.deleteMany({ where: { id: serviceId } })
  if (categoryId) await prisma.serviceCategory.deleteMany({ where: { id: categoryId } })
  if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } })
  vi.unstubAllEnvs(); await prisma.$disconnect()
})
it('publish → one analysis → pro question → admin correction → reused without a provider call', async () => {
  await enqueueLookMediaAnalyses(prisma, lookId)
  await enqueueLookMediaAnalyses(prisma, lookId)
  expect(await prisma.lookMediaAnalysis.count({ where: { mediaAssetId: mediaId } })).toBe(1)
  const provider = vi.fn(async () => ({ analysis, credibilityFlags: [], model: 'test-model' }))
  expect(await processNextLookAnalysis({ provider, hairMapProvider: async () => ({ raw: hairMapFixture('inspiration'), model: 'test-model' }), frames: async () => [{ atSeconds: 0, mediaType: 'image/jpeg', base64: '/9j/2Q==' }] })).toEqual({ status: 'NEEDS_PRO' })
  expect(provider).toHaveBeenCalledTimes(1)
  expect(await prisma.notification.count({ where: { professionalId: proId, eventKey: 'LOOK_MEDIA_CLARIFICATION' } })).toBe(1)
  const scope = { admin: false, professionalId: proId, actorUserId: userId }
  const [item] = await listLookAnalyses(scope)
  expect(item).toBeDefined()
  if (!item) throw new Error('Missing reading')
  expect(await listLookAnalyses({ ...scope, professionalId: 'another-pro' })).toEqual([])
  await expect(mutateLookAnalysis({ ...scope, professionalId: 'another-pro' }, item.id, { revision: item.revision, action: 'answer', answers: { 'field:tone': 'COOL' } })).rejects.toMatchObject({ status: 404 })
  await mutateLookAnalysis(scope, item.id, { revision: item.revision, action: 'answer', answers: { 'field:tone': 'COOL' } })
  await expect(mutateLookAnalysis(scope, item.id, { revision: item.revision, action: 'answer', answers: { 'field:tone': 'WARM' } })).rejects.toMatchObject({ status: 409 })
  expect(await prisma.adminNotification.count({ where: { adminUserId: adminId, eventKey: 'LOOK_MEDIA_ADMIN_REVIEW' } })).toBe(1)
  const admin = { admin: true, professionalId: null, actorUserId: adminId }
  const [review] = await listLookAnalyses(admin)
  if (!review) throw new Error('Missing admin review')
  expect(review.answers).toEqual({ 'field:tone': 'COOL' })
  await mutateLookAnalysis(admin, item.id, { revision: review.revision, action: 'approve', corrections: { tone: { value: 'COOL', confidence: { min: 0.6, max: 0.8 }, region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } } } })
  const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaId }, select: LOOK_ANALYSIS_ASSET_SELECT })
  const reusable = await loadReusableLookAnalysis(prisma, asset)
  expect(reusable?.reading.attributes.tone?.value).toBe('COOL')
  const neverCall = vi.fn()
  if (!reusable) throw new Error('Missing reusable analysis')
  const result = await performConsultInspirationRead({ plan: { target: { kind: 'LOOK', inspirationId: 'test-ref', source: 'PLATFORM_LOOK', pointers: { storageBucket: asset.storageBucket, storagePath: asset.storagePath, url: null, analysisAsset: asset } }, requestHash: 'test', artefact: null, reusable }, consultSessionId: 'test', clientId: 'test', provider: neverCall })
  expect(result.analysis.tone.value).toBe('COOL')
  expect(neverCall).not.toHaveBeenCalled()
  const original = await prisma.lookMediaAnalysis.findUniqueOrThrow({ where: { id: item.id } })
  expect(JSON.stringify(original.readings)).toContain('UNKNOWN')
  expect(await prisma.lookMediaAnalysisReview.count({ where: { analysisId: item.id } })).toBe(2)
  await expect(prisma.lookMediaAnalysisReview.updateMany({ where: { analysisId: item.id }, data: { action: 'reject' } })).rejects.toThrow()
  await prisma.mediaAsset.update({ where: { id: mediaId }, data: { cropX: 0.1, cropY: 0.1, cropW: 0.8, cropH: 0.8 } })
  const replaced = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaId }, select: LOOK_ANALYSIS_ASSET_SELECT })
  expect(await loadReusableLookAnalysis(prisma, replaced)).toBeNull()
  await enqueueLookMediaAnalyses(prisma, lookId)
  expect(await prisma.lookMediaAnalysis.count({ where: { mediaAssetId: mediaId } })).toBe(2)
  await prisma.lookPost.update({ where: { id: lookId }, data: { status: 'ARCHIVED' } })
  expect(await loadReusableLookAnalysis(prisma, asset)).toBeNull()
})
