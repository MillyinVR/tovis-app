// lib/media/evidenceBundleData.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaPhase, MediaType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  mediaAssetFindMany: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findUnique: mocks.bookingFindUnique },
    mediaAsset: { findMany: mocks.mediaAssetFindMany },
  },
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        download: mocks.download,
      }),
    },
  }),
}))

import { gatherEvidenceBundleData } from './evidenceBundleData'

const BOOKING_ROW = {
  id: 'booking_1',
  professionalId: 'pro_1',
  status: 'COMPLETED',
  scheduledFor: new Date('2026-08-10T18:00:00.000Z'),
  locationTimeZone: 'America/Los_Angeles',
  client: { firstName: 'Ada', lastName: 'Lovelace' },
  service: { name: 'Balayage' },
}

const ATTESTATION = {
  sha256Server: 'a'.repeat(64),
  sha256Client: null,
  hashMismatch: false,
  capturedAtClaimed: null,
  receivedAt: new Date('2026-08-10T18:05:00.000Z'),
}

function mediaRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'media_1',
    phase: MediaPhase.BEFORE,
    mediaType: MediaType.IMAGE,
    caption: null,
    createdAt: new Date('2026-08-10T18:04:00.000Z'),
    storageBucket: 'media-private',
    storagePath: 'bookings/booking_1/before/main.jpg',
    captureAttestation: ATTESTATION,
    ...overrides,
  }
}

function makeBlob(bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)])
}

describe('gatherEvidenceBundleData', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when the booking does not exist', async () => {
    mocks.bookingFindUnique.mockResolvedValue(null)

    const result = await gatherEvidenceBundleData({
      bookingId: 'missing',
      professionalId: 'pro_1',
    })

    expect(result).toEqual({ ok: false, status: 404, error: 'Booking not found.' })
    expect(mocks.mediaAssetFindMany).not.toHaveBeenCalled()
  })

  it('returns 404 for a foreign booking — no existence leak', async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      ...BOOKING_ROW,
      professionalId: 'someone_else',
    })

    const result = await gatherEvidenceBundleData({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
    })

    expect(result).toEqual({ ok: false, status: 404, error: 'Booking not found.' })
  })

  it('returns 404 when the booking has no session media', async () => {
    mocks.bookingFindUnique.mockResolvedValue(BOOKING_ROW)
    mocks.mediaAssetFindMany.mockResolvedValue([])

    const result = await gatherEvidenceBundleData({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
    })

    expect(result.ok).toBe(false)
  })

  it('downloads bytes for each asset and carries its attestation (or null)', async () => {
    mocks.bookingFindUnique.mockResolvedValue(BOOKING_ROW)
    mocks.mediaAssetFindMany.mockResolvedValue([
      mediaRow({ id: 'media_1' }),
      mediaRow({ id: 'media_2', captureAttestation: null, phase: MediaPhase.AFTER }),
    ])
    mocks.download.mockResolvedValue({ data: makeBlob([1, 2, 3]), error: null })

    const result = await gatherEvidenceBundleData({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.clientName).toBe('Ada Lovelace')
    expect(result.data.serviceName).toBe('Balayage')
    expect(result.data.timeZone).toBe('America/Los_Angeles')
    expect(result.data.assets).toHaveLength(2)
    expect(result.data.assets[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(result.data.assets[0]?.attestation).toEqual(ATTESTATION)
    expect(result.data.assets[1]?.attestation).toBeNull()
  })

  it('carries a download failure as downloadError instead of throwing', async () => {
    mocks.bookingFindUnique.mockResolvedValue(BOOKING_ROW)
    mocks.mediaAssetFindMany.mockResolvedValue([mediaRow()])
    mocks.download.mockResolvedValue({ data: null, error: new Error('gone') })

    const result = await gatherEvidenceBundleData({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.assets[0]?.bytes).toBeNull()
    expect(result.data.assets[0]?.downloadError).toEqual(expect.any(String))
  })

  it('falls back to a generic client name when both name fields are blank', async () => {
    mocks.bookingFindUnique.mockResolvedValue({
      ...BOOKING_ROW,
      client: { firstName: null, lastName: null },
    })
    mocks.mediaAssetFindMany.mockResolvedValue([mediaRow()])
    mocks.download.mockResolvedValue({ data: makeBlob([1]), error: null })

    const result = await gatherEvidenceBundleData({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.clientName).toBe('Client')
  })
})
