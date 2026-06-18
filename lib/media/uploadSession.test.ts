import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaPhase, UploadSessionStatus, UploadSurface } from '@prisma/client'
import {
  UPLOAD_SESSION_TTL_MS,
  UploadSessionError,
  consumeUploadSession,
  createUploadSession,
  expireStaleUploadSessions,
  uploadSurfaceForKind,
  validateUploadSession,
} from './uploadSession'

const NOW = new Date('2026-06-14T12:00:00.000Z')

function makeDb() {
  return {
    uploadSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'us_1',
    surface: UploadSurface.PRO_BOOKING_MEDIA,
    status: UploadSessionStatus.PENDING,
    tenantId: 'tenant_1',
    professionalId: 'pro_1',
    clientId: null,
    bookingId: 'bk_1',
    phase: MediaPhase.BEFORE,
    storageBucket: 'media-private',
    storagePath: 'bookings/bk_1/before/x.jpg',
    contentType: 'image/jpeg',
    maxBytes: 30 * 1024 * 1024,
    checksumSha256: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
    consumedAt: null,
    mediaAssetId: null,
    ...overrides,
  }
}

describe('createUploadSession', () => {
  it('creates a PENDING session expiring at now + TTL', async () => {
    const db = makeDb()
    db.uploadSession.create.mockResolvedValueOnce({
      id: 'us_1',
      expiresAt: new Date(NOW.getTime() + UPLOAD_SESSION_TTL_MS),
    })

    const out = await createUploadSession(db as AnyDb, {
      surface: UploadSurface.PRO_LOOKS,
      storageBucket: 'media-public',
      storagePath: 'pro/pro_1/looks/x.jpg',
      contentType: 'image/jpeg',
      maxBytes: 100,
      professionalId: 'pro_1',
      tenantId: 'tenant_1',
      now: NOW,
    })

    expect(out.id).toBe('us_1')
    const arg = db.uploadSession.create.mock.calls[0]![0]
    expect(arg.data.status).toBe(UploadSessionStatus.PENDING)
    expect(arg.data.expiresAt.getTime()).toBe(NOW.getTime() + UPLOAD_SESSION_TTL_MS)
    expect(arg.data.clientId).toBeNull()
  })
})

describe('validateUploadSession', () => {
  it('returns the row when everything matches', async () => {
    const db = makeDb()
    db.uploadSession.findUnique.mockResolvedValueOnce(sessionRow())

    const row = await validateUploadSession(db as AnyDb, {
      uploadSessionId: 'us_1',
      surface: UploadSurface.PRO_BOOKING_MEDIA,
      professionalId: 'pro_1',
      bookingId: 'bk_1',
      phase: MediaPhase.BEFORE,
      now: NOW,
    })

    expect(row.storagePath).toBe('bookings/bk_1/before/x.jpg')
  })

  it('throws NOT_FOUND for a missing session', async () => {
    const db = makeDb()
    db.uploadSession.findUnique.mockResolvedValueOnce(null)

    await expect(
      validateUploadSession(db as AnyDb, {
        uploadSessionId: 'nope',
        surface: UploadSurface.PRO_BOOKING_MEDIA,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws SURFACE_MISMATCH when the surface differs', async () => {
    const db = makeDb()
    db.uploadSession.findUnique.mockResolvedValueOnce(sessionRow())

    await expect(
      validateUploadSession(db as AnyDb, {
        uploadSessionId: 'us_1',
        surface: UploadSurface.CLIENT_REVIEW,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'SURFACE_MISMATCH' })
  })

  it('throws ALREADY_CONSUMED for a consumed session', async () => {
    const db = makeDb()
    db.uploadSession.findUnique.mockResolvedValueOnce(
      sessionRow({ status: UploadSessionStatus.CONSUMED }),
    )

    await expect(
      validateUploadSession(db as AnyDb, {
        uploadSessionId: 'us_1',
        surface: UploadSurface.PRO_BOOKING_MEDIA,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_CONSUMED' })
  })

  it('throws EXPIRED past the expiry even if still PENDING', async () => {
    const db = makeDb()
    db.uploadSession.findUnique.mockResolvedValueOnce(
      sessionRow({ expiresAt: new Date(NOW.getTime() - 1) }),
    )

    await expect(
      validateUploadSession(db as AnyDb, {
        uploadSessionId: 'us_1',
        surface: UploadSurface.PRO_BOOKING_MEDIA,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'EXPIRED' })
  })

  it('throws FORBIDDEN for the wrong professional', async () => {
    const db = makeDb()
    db.uploadSession.findUnique.mockResolvedValueOnce(sessionRow())

    await expect(
      validateUploadSession(db as AnyDb, {
        uploadSessionId: 'us_1',
        surface: UploadSurface.PRO_BOOKING_MEDIA,
        professionalId: 'pro_OTHER',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('throws CONTEXT_MISMATCH for the wrong booking or phase', async () => {
    const db = makeDb()
    db.uploadSession.findUnique.mockResolvedValue(sessionRow())

    await expect(
      validateUploadSession(db as AnyDb, {
        uploadSessionId: 'us_1',
        surface: UploadSurface.PRO_BOOKING_MEDIA,
        bookingId: 'bk_OTHER',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'CONTEXT_MISMATCH' })

    await expect(
      validateUploadSession(db as AnyDb, {
        uploadSessionId: 'us_1',
        surface: UploadSurface.PRO_BOOKING_MEDIA,
        phase: MediaPhase.AFTER,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'CONTEXT_MISMATCH' })
  })
})

describe('consumeUploadSession', () => {
  it('flips PENDING -> CONSUMED when exactly one row matches', async () => {
    const db = makeDb()
    db.uploadSession.updateMany.mockResolvedValueOnce({ count: 1 })

    await expect(
      consumeUploadSession(db as AnyDb, {
        uploadSessionId: 'us_1',
        mediaAssetId: 'media_1',
        now: NOW,
      }),
    ).resolves.toBeUndefined()

    const arg = db.uploadSession.updateMany.mock.calls[0]![0]
    expect(arg.where.status).toBe(UploadSessionStatus.PENDING)
    expect(arg.data.mediaAssetId).toBe('media_1')
  })

  it('throws CONSUME_CONFLICT when no PENDING row matched (double-attach race)', async () => {
    const db = makeDb()
    db.uploadSession.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(
      consumeUploadSession(db as AnyDb, {
        uploadSessionId: 'us_1',
        mediaAssetId: 'media_1',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'CONSUME_CONFLICT' })
  })
})

describe('expireStaleUploadSessions', () => {
  it('marks expired PENDING sessions and returns the count', async () => {
    const db = makeDb()
    db.uploadSession.updateMany.mockResolvedValueOnce({ count: 3 })

    const n = await expireStaleUploadSessions(db as AnyDb, NOW)
    expect(n).toBe(3)
    const arg = db.uploadSession.updateMany.mock.calls[0]![0]
    expect(arg.where.status).toBe(UploadSessionStatus.PENDING)
    expect(arg.data.status).toBe(UploadSessionStatus.EXPIRED)
  })
})

describe('uploadSurfaceForKind', () => {
  it('maps MediaAsset-producing kinds and returns null otherwise', () => {
    expect(uploadSurfaceForKind('CONSULT_PRIVATE')).toBe(UploadSurface.PRO_BOOKING_MEDIA)
    expect(uploadSurfaceForKind('LOOKS_PUBLIC')).toBe(UploadSurface.PRO_LOOKS)
    expect(uploadSurfaceForKind('PORTFOLIO_PUBLIC')).toBe(UploadSurface.PRO_PORTFOLIO)
    // A private portfolio upload uses the same surface; bucket/visibility differ.
    expect(uploadSurfaceForKind('PORTFOLIO_PRIVATE')).toBe(UploadSurface.PRO_PORTFOLIO)
    expect(uploadSurfaceForKind('REVIEW_PUBLIC')).toBe(UploadSurface.CLIENT_REVIEW)
    expect(uploadSurfaceForKind('AVATAR_PUBLIC')).toBeNull()
    expect(uploadSurfaceForKind('VERIFY_PRIVATE')).toBeNull()
  })
})

it('UploadSessionError carries an http status', () => {
  expect(new UploadSessionError('FORBIDDEN', 'x').httpStatus).toBe(403)
  expect(new UploadSessionError('EXPIRED', 'x').httpStatus).toBe(410)
})
