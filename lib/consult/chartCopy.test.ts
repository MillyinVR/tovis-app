import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(), agreements: vi.fn(), session: vi.fn(), captures: vi.fn(), create: vi.fn(), update: vi.fn(), booking: vi.fn(),
}))
vi.mock('./agreementContract', () => ({ requireCurrentConsultAgreementAcceptances: mocks.agreements }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  consultSession: { findUnique: mocks.session },
  consultCapture: { findMany: mocks.captures },
  booking: { findUnique: mocks.booking },
  $transaction: async (work: (tx: { $queryRaw: typeof mocks.query; consultCapture: { findMany: typeof mocks.captures }; mediaAsset: { createMany: typeof mocks.create }; consultSession: { findUnique: typeof mocks.session; update: typeof mocks.update } }) => Promise<void>) =>
    work({ $queryRaw: mocks.query, consultCapture: { findMany: mocks.captures }, mediaAsset: { createMany: mocks.create }, consultSession: { findUnique: mocks.session, update: mocks.update } }),
} }))
import { copyBookedConsultCapturesToChart, copyConsultCapturesToChart } from './chartCopy'
import { CONSULT_CAPTURE_BUCKET, type ConsultCaptureStorage } from './captureStorage'

const copyObject = vi.fn()
const storage: ConsultCaptureStorage = {
  assertReady: vi.fn(), createSignedUpload: vi.fn(), inspectObject: vi.fn(),
  readObject: vi.fn(), createSignedRead: vi.fn(), purgeObject: vi.fn(), copyObject,
}
const booking = { id: 'booking', serviceId: 'service', proTenantId: 'tenant', status: 'ACCEPTED',
  scheduledFor: new Date('2026-10-01'), totalDurationMinutes: 60 }
const session = { id: 'consult', professionalId: 'pro', chartCopyOptIn: true,
  chartCopyCompletedAt: null, status: 'COMPLETED', client: { userId: 'client-user' },
  bookingId: null, booking: null, inspiredBookings: [booking] }

beforeEach(() => {
  mocks.agreements.mockResolvedValue(undefined)
  mocks.session.mockResolvedValue(session)
  mocks.captures.mockResolvedValue([{ id: 'capture', shotKey: 'early_photo',
    storageBucket: CONSULT_CAPTURE_BUCKET, storagePath: 'raw/capture.jpg', contentType: 'image/jpeg' }])
})

describe('durable consultation chart copies', () => {
  it('files a look-started consultation under its committed booking', async () => {
    await copyConsultCapturesToChart({ consultSessionId: 'consult', captureIds: ['capture'], storage })
    expect(copyObject).toHaveBeenCalledOnce()
    expect(mocks.create).toHaveBeenCalledWith({ skipDuplicates: true, data: [expect.objectContaining({
      bookingId: 'booking', primaryServiceId: 'service', professionalId: 'pro', visibility: 'PRO_CLIENT', phase: 'BEFORE',
    })] })
  })
  it('preserves booking-attached consultation behavior', async () => {
    mocks.session.mockResolvedValue({ ...session, bookingId: booking.id, booking, inspiredBookings: [] })
    await copyConsultCapturesToChart({ consultSessionId: 'consult', captureIds: ['capture'], storage })
    expect(mocks.create).toHaveBeenCalledOnce()
  })
  it.each([
    { ...session, chartCopyOptIn: false },
    { ...session, status: 'CANCELLED' },
    { ...session, inspiredBookings: [] },
    { ...session, inspiredBookings: [{ ...booking, status: 'CANCELLED' }] },
    { ...session, inspiredBookings: [{ ...booking, status: 'NO_SHOW' }] },
  ])('does not copy without consent and a usable visit', async value => {
    mocks.session.mockResolvedValue(value)
    await copyConsultCapturesToChart({ consultSessionId: 'consult', captureIds: ['capture'], storage })
    expect(copyObject).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('does not let an earlier copy suppress a newly accepted retake', async () => {
    mocks.session.mockResolvedValue({ ...session, chartCopyCompletedAt: new Date() })
    await copyConsultCapturesToChart({ consultSessionId: 'consult', captureIds: ['capture'], storage })
    expect(copyObject).toHaveBeenCalledOnce()
    expect(mocks.captures).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: { in: ['capture'] }, purgeRequestedAt: null, purgedAt: null, rawExpiresAt: { gt: expect.any(Date) },
    }) }))
  })
  it('uses the committed booking link rather than a request-provided consult', async () => {
    mocks.booking.mockResolvedValue({ sourceConsultSessionId: null })
    await copyBookedConsultCapturesToChart('ordinary-booking')
    expect(mocks.booking).toHaveBeenCalledWith({ where: { id: 'ordinary-booking' }, select: { sourceConsultSessionId: true } })
    expect(mocks.captures).not.toHaveBeenCalled()
  })
  it('checks current agreements under the same lock before any durable copy', async () => {
    mocks.agreements.mockRejectedValue(new Error('consent revoked'))
    await expect(copyConsultCapturesToChart({ consultSessionId: 'consult', captureIds: ['capture'], storage })).rejects.toThrow('consent revoked')
    expect(copyObject).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

})
