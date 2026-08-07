// lib/licensing/verificationDocRetention.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const verificationDocument = {
    findMany: vi.fn(),
    update: vi.fn(),
  }
  const storageRemove = vi.fn()
  const captureLicensingException = vi.fn()

  return {
    verificationDocument,
    storageRemove,
    captureLicensingException,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: { verificationDocument: mocks.verificationDocument },
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    storage: { from: () => ({ remove: mocks.storageRemove }) },
  }),
}))

vi.mock('@/lib/observability/licensingEvents', () => ({
  captureLicensingException: mocks.captureLicensingException,
}))

import {
  VERIFICATION_DOC_RETENTION_DAYS,
  runVerificationDocRetentionSweep,
} from './verificationDocRetention'

const NOW = new Date('2026-08-06T12:00:00.000Z')
const MS_PER_DAY = 24 * 60 * 60 * 1000

describe('runVerificationDocRetentionSweep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verificationDocument.findMany.mockResolvedValue([])
    mocks.verificationDocument.update.mockResolvedValue({})
    mocks.storageRemove.mockResolvedValue({ data: [], error: null })
  })

  it('queries reviewed-and-not-yet-purged docs older than the retention window', async () => {
    await runVerificationDocRetentionSweep(NOW)

    expect(mocks.verificationDocument.findMany).toHaveBeenCalledWith({
      where: {
        reviewedAt: { lte: new Date(NOW.getTime() - VERIFICATION_DOC_RETENTION_DAYS * MS_PER_DAY) },
        fileDeletedAt: null,
        OR: [{ imageUrl: { not: null } }, { url: { not: null } }],
      },
      select: { id: true, professionalId: true, imageUrl: true, url: true },
    })
  })

  it('deletes the storage object and nulls the URL fields, stamping fileDeletedAt', async () => {
    mocks.verificationDocument.findMany.mockResolvedValue([
      {
        id: 'doc_1',
        professionalId: 'pro_1',
        imageUrl: null,
        url: 'supabase://media-private/pro_1/license.pdf',
      },
    ])

    const result = await runVerificationDocRetentionSweep(NOW)

    expect(result).toEqual({ considered: 1, purged: 1, failed: 0 })
    expect(mocks.storageRemove).toHaveBeenCalledWith(['pro_1/license.pdf'])
    expect(mocks.verificationDocument.update).toHaveBeenCalledWith({
      where: { id: 'doc_1' },
      data: { imageUrl: null, url: null, fileDeletedAt: NOW },
    })
  })

  it('deletes both pointers when a document somehow has both imageUrl and url', async () => {
    mocks.verificationDocument.findMany.mockResolvedValue([
      {
        id: 'doc_1',
        professionalId: 'pro_1',
        imageUrl: 'supabase://media-private/pro_1/id.jpg',
        url: 'supabase://media-private/pro_1/license.pdf',
      },
    ])

    await runVerificationDocRetentionSweep(NOW)

    expect(mocks.storageRemove).toHaveBeenCalledTimes(2)
    expect(mocks.storageRemove).toHaveBeenNthCalledWith(1, ['pro_1/id.jpg'])
    expect(mocks.storageRemove).toHaveBeenNthCalledWith(2, ['pro_1/license.pdf'])
  })

  it('captures and skips a document whose storage delete fails, without aborting the sweep', async () => {
    mocks.verificationDocument.findMany.mockResolvedValue([
      { id: 'doc_bad', professionalId: 'pro_1', imageUrl: null, url: 'supabase://media-private/a.pdf' },
      { id: 'doc_ok', professionalId: 'pro_2', imageUrl: null, url: 'supabase://media-private/b.pdf' },
    ])
    mocks.storageRemove
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ data: [], error: null })

    const result = await runVerificationDocRetentionSweep(NOW)

    expect(result).toEqual({ considered: 2, purged: 1, failed: 1 })
    expect(mocks.captureLicensingException).toHaveBeenCalledTimes(1)
    expect(mocks.captureLicensingException).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'VERIFICATION_DOC_RETENTION_PURGE_FAILED',
        professionalId: 'pro_1',
        documentId: 'doc_bad',
      }),
    )
    // The failed doc's row was never updated — it stays a candidate next run.
    expect(mocks.verificationDocument.update).toHaveBeenCalledTimes(1)
    expect(mocks.verificationDocument.update).toHaveBeenCalledWith({
      where: { id: 'doc_ok' },
      data: { imageUrl: null, url: null, fileDeletedAt: NOW },
    })
  })

  it('does nothing when there are no candidates', async () => {
    const result = await runVerificationDocRetentionSweep(NOW)
    expect(result).toEqual({ considered: 0, purged: 0, failed: 0 })
    expect(mocks.storageRemove).not.toHaveBeenCalled()
    expect(mocks.verificationDocument.update).not.toHaveBeenCalled()
  })
})
