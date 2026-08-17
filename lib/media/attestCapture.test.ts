// lib/media/attestCapture.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hashStorageObjectBytes: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/media/hashStorageObject', () => ({
  hashStorageObjectBytes: mocks.hashStorageObjectBytes,
  MediaHashError: class MediaHashError extends Error {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mediaCaptureAttestation: {
      create: mocks.create,
    },
  },
}))

import { attestMediaCapture } from './attestCapture'

const BASE_INPUT = {
  mediaAssetId: 'media_1',
  bookingId: 'booking_1',
  professionalId: 'pro_1',
  storageBucket: 'media-private',
  storagePath: 'bookings/booking_1/before/main.jpg',
  capturedAtClaimed: null as Date | null,
  clientChecksumSha256: null as string | null,
  now: new Date('2026-08-17T12:00:00.000Z'),
}

const SERVER_HASH = 'a'.repeat(64)

describe('attestMediaCapture', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('writes sha256Server from the downloaded bytes, not from any client claim', async () => {
    mocks.hashStorageObjectBytes.mockResolvedValue({
      sha256: SERVER_HASH,
      sizeBytes: 123,
    })
    mocks.create.mockResolvedValue({})

    const result = await attestMediaCapture(BASE_INPUT)

    expect(mocks.hashStorageObjectBytes).toHaveBeenCalledWith({
      bucket: BASE_INPUT.storageBucket,
      path: BASE_INPUT.storagePath,
      maxBytes: expect.any(Number),
    })
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        mediaAssetId: BASE_INPUT.mediaAssetId,
        bookingId: BASE_INPUT.bookingId,
        professionalId: BASE_INPUT.professionalId,
        sha256Server: SERVER_HASH,
        sha256Client: null,
        hashMismatch: false,
        capturedAtClaimed: null,
        receivedAt: BASE_INPUT.now,
      },
    })
    expect(result).toEqual({ sha256Server: SERVER_HASH, hashMismatch: false })
  })

  it('stores a matching client checksum with no mismatch flagged', async () => {
    mocks.hashStorageObjectBytes.mockResolvedValue({
      sha256: SERVER_HASH,
      sizeBytes: 123,
    })
    mocks.create.mockResolvedValue({})

    const result = await attestMediaCapture({
      ...BASE_INPUT,
      clientChecksumSha256: SERVER_HASH,
    })

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sha256Server: SERVER_HASH,
        sha256Client: SERVER_HASH,
        hashMismatch: false,
      }),
    })
    expect(result.hashMismatch).toBe(false)
  })

  it('stores a mismatched client checksum AND flags it — never trusts the claim alone', async () => {
    const claimedHash = 'b'.repeat(64)
    mocks.hashStorageObjectBytes.mockResolvedValue({
      sha256: SERVER_HASH,
      sizeBytes: 123,
    })
    mocks.create.mockResolvedValue({})

    const result = await attestMediaCapture({
      ...BASE_INPUT,
      clientChecksumSha256: claimedHash,
    })

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sha256Server: SERVER_HASH,
        sha256Client: claimedHash,
        hashMismatch: true,
      }),
    })
    expect(result).toEqual({ sha256Server: SERVER_HASH, hashMismatch: true })
  })

  it('stores the device-claimed capture time as-is, alongside the authoritative receivedAt', async () => {
    mocks.hashStorageObjectBytes.mockResolvedValue({
      sha256: SERVER_HASH,
      sizeBytes: 123,
    })
    mocks.create.mockResolvedValue({})

    const capturedAtClaimed = new Date('2026-08-15T09:00:00.000Z')

    await attestMediaCapture({ ...BASE_INPUT, capturedAtClaimed })

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        capturedAtClaimed,
        receivedAt: BASE_INPUT.now,
      }),
    })
  })

  it('propagates a hashing failure instead of writing a row with no real hash', async () => {
    mocks.hashStorageObjectBytes.mockRejectedValue(new Error('missing'))

    await expect(attestMediaCapture(BASE_INPUT)).rejects.toThrow('missing')
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
