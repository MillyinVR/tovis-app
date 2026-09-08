import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ enabled: true, state: vi.fn(), issue: vi.fn(), attach: vi.fn(), quality: vi.fn(),
  previous: vi.fn(), capture: vi.fn(), create: vi.fn(), saved: vi.fn(), chart: vi.fn(), source: vi.fn(), consent: vi.fn(),
  copy: vi.fn(), inspect: vi.fn(), scope: vi.fn() }))
vi.mock('@/lib/env', () => ({ readOptionalEnv: () => m.enabled ? 'true' : undefined }))
vi.mock('./agreementContract', () => ({ requireCurrentConsultAgreementAcceptances: m.consent }))
vi.mock('./openWindow', () => ({ CONSULT_OPEN_WINDOW_SELECT: {}, assertConsultReadableScope: m.scope }))
vi.mock('./chartFacts', () => ({ loadClientChartFacts: m.chart }))
vi.mock('./captureContract', () => ({ loadConsultCaptureState: m.state, issueConsultCaptureUpload: m.issue,
  attachConsultCaptureUpload: m.attach, checkConsultCaptureQuality: m.quality }))
vi.mock('./captureStorage', () => ({ CONSULT_CAPTURE_BUCKET: 'private', CONSULT_CAPTURE_MAX_BYTES: 8_388_608,
  consultCaptureStorage: { assertReady: vi.fn(), inspectObject: m.inspect, copyObject: m.copy } }))
vi.mock('@/lib/prisma', () => {
  const tx = { $queryRaw: vi.fn(), consultSession: { findUnique: vi.fn(async () => ({ id: 'consult', clientId: 'client', professionalId: 'pro' })) },
    mediaAsset: { findFirst: m.source }, consultChartPhotoUse: { createMany: m.create, findUniqueOrThrow: m.saved } }
  return { prisma: { $transaction: async (work: (db: typeof tx) => Promise<unknown>) => work(tx),
    consultChartPhotoUse: { findUnique: m.previous }, consultCapture: { findUnique: m.capture },
    uploadSession: { findUniqueOrThrow: vi.fn(async () => ({ storagePath: 'capture/new.jpg' })) } } }
})
import { confirmClientChartPhoto } from './chartPhoto'
const args = { consultSessionId: 'consult', clientId: 'client', actorUserId: 'user', mediaAssetId: 'photo', idempotencyKey: 'tap' }
beforeEach(() => {
  vi.clearAllMocks(); m.enabled = true
  m.state.mockResolvedValue({ shotPack: { schemaVersion: 1 } }); m.previous.mockResolvedValue(null)
  m.chart.mockResolvedValue({ photos: [{ mediaAssetId: 'photo', recordedAt: '2026-09-01T12:00:00Z' }] })
  m.source.mockResolvedValue({ id: 'photo', storagePath: 'consult-chart/v1/a.jpg' })
  m.capture.mockResolvedValue(null); m.inspect.mockResolvedValue({ sizeBytes: 100, checksumSha256: 'hash' })
  m.issue.mockResolvedValue({ upload: { uploadSessionId: 'upload' } }); m.attach.mockResolvedValue({ captureId: 'capture' })
  m.saved.mockResolvedValue({ id: 'use', mediaAssetId: 'photo', captureId: 'capture' })
  m.consent.mockResolvedValue(undefined); m.quality.mockResolvedValue(undefined)
})
describe('explicit chart photo reuse', () => {
  it('uses the existing attach and quality gates and records original photo date', async () => {
    await confirmClientChartPhoto(args)
    expect(m.copy).toHaveBeenCalledWith({ fromPath: 'consult-chart/v1/a.jpg', toPath: 'capture/new.jpg' })
    expect(m.attach).toHaveBeenCalledOnce(); expect(m.quality).toHaveBeenCalledWith(expect.objectContaining({ captureId: 'capture' }))
    expect(m.create.mock.calls[0]?.[0].data[0]).toMatchObject({ mediaAssetId: 'photo', sourceRecordedAt: new Date('2026-09-01T12:00:00Z') })
  })
  it('recovers a crash after attach without creating another capture', async () => {
    m.capture.mockResolvedValue({ id: 'capture' })
    await confirmClientChartPhoto(args)
    expect(m.issue).not.toHaveBeenCalled(); expect(m.copy).not.toHaveBeenCalled(); expect(m.attach).not.toHaveBeenCalled()
    expect(m.quality).toHaveBeenCalledOnce()
  })
  it('replays the same quality operation after confirmation was recorded', async () => {
    m.previous.mockResolvedValue({ id: 'use', mediaAssetId: 'photo', captureId: 'capture' })
    await confirmClientChartPhoto(args)
    expect(m.issue).not.toHaveBeenCalled(); expect(m.chart).not.toHaveBeenCalled()
    const quality = m.quality.mock.calls[0]?.[0]
    expect(await quality.loadInput()).toMatchObject({ idempotencyKey: 'chart-quality:use' })
  })
  it('rejects a different or deleted source on a reused confirmation', async () => {
    for (const mediaAssetId of ['other', null]) {
      m.previous.mockResolvedValue({ id: 'use', mediaAssetId, captureId: 'capture' })
      await expect(confirmClientChartPhoto(args)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    }
    expect(m.quality).not.toHaveBeenCalled()
  })
  it('cannot copy a deleted, expired or unshared source', async () => {
    m.chart.mockResolvedValue({ photos: [] })
    await expect(confirmClientChartPhoto(args)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(m.copy).not.toHaveBeenCalled(); expect(m.issue).not.toHaveBeenCalled()
  })
  it('does not record confirmation after consent is revoked', async () => {
    m.consent.mockRejectedValue(new Error('revoked'))
    await expect(confirmClientChartPhoto(args)).rejects.toThrow('revoked')
    expect(m.create).not.toHaveBeenCalled(); expect(m.quality).not.toHaveBeenCalled()
  })
  it('fails closed when disabled', async () => {
    m.enabled = false
    await expect(confirmClientChartPhoto(args)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(m.state).not.toHaveBeenCalled()
  })
})
