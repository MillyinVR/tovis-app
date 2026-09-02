import { MediaType } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn((data?: Record<string, unknown>, status = 200) =>
    Response.json({ ok: true, ...(data ?? {}) }, { status }),
  ),
  jsonFail: vi.fn((status: number, error: string) =>
    Response.json({ ok: false, error }, { status }),
  ),
  requirePro: vi.fn(),
  mediaAssetFindUnique: vi.fn(),
  mediaAssetUpdateMany: vi.fn(),
  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
  pickString: (value: unknown) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mediaAsset: {
      findUnique: mocks.mediaAssetFindUnique,
      updateMany: mocks.mediaAssetUpdateMany,
    },
  },
}))

vi.mock('@/lib/security/logging', () => ({ safeError: mocks.safeError }))

import { PUT } from './route'

function makeCtx(id = 'media_1') {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/media/media_1/crop', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type Rect = { x: number; y: number; w: number; h: number }

/** The undo-window columns, defaulted to "no window has ever been opened". */
type UndoOverrides = {
  undoBound?: Rect | null
  undoExpiresAt?: Date | null
  undoViewBaseline?: number | null
  /** Views on looks this asset is the PRIMARY media of. */
  primaryViews?: number[]
  /** Views on looks it merely appears in. */
  secondaryViews?: number[]
}

/** An asset owned by the authed pro, framed as `crop` (null = never re-framed). */
function ownedAsset(
  crop: Rect | null,
  mediaType: MediaType = MediaType.IMAGE,
  undo: UndoOverrides = {},
) {
  return {
    id: 'media_1',
    professionalId: 'pro_1',
    mediaType,
    cropX: crop?.x ?? null,
    cropY: crop?.y ?? null,
    cropW: crop?.w ?? null,
    cropH: crop?.h ?? null,
    cropUndoBoundX: undo.undoBound?.x ?? null,
    cropUndoBoundY: undo.undoBound?.y ?? null,
    cropUndoBoundW: undo.undoBound?.w ?? null,
    cropUndoBoundH: undo.undoBound?.h ?? null,
    cropUndoExpiresAt: undo.undoExpiresAt ?? null,
    cropUndoViewBaseline: undo.undoViewBaseline ?? null,
    lookPostPrimaryFor: (undo.primaryViews ?? []).map((viewCount) => ({ viewCount })),
    lookPostAssets: (undo.secondaryViews ?? []).map((viewCount) => ({
      lookPost: { viewCount },
    })),
  }
}

/** An expiry comfortably in the future / already past, relative to the test run. */
const OPEN_UNTIL = () => new Date(Date.now() + 60 * 60 * 1000)
const ALREADY_EXPIRED = () => new Date(Date.now() - 1000)

describe('PUT /api/v1/pro/media/[id]/crop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
    mocks.mediaAssetUpdateMany.mockResolvedValue({ count: 1 })
  })

  it('stores a first re-frame anywhere inside the published photo', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(ownedAsset(null))

    const res = await PUT(
      makeRequest({ cropX: 0.1, cropY: 0.2, cropW: 0.5, cropH: 0.6 }),
      makeCtx(),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      media: { id: 'media_1', cropX: 0.1, cropY: 0.2, cropW: 0.5, cropH: 0.6 },
    })
    expect(mocks.mediaAssetUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cropX: 0.1,
          cropY: 0.2,
          cropW: 0.5,
          cropH: 0.6,
        }),
      }),
    )
  })

  it('lets a re-frame tighten inside the frame already published', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }),
    )

    const res = await PUT(
      makeRequest({ cropX: 0.3, cropY: 0.3, cropW: 0.2, cropH: 0.2 }),
      makeCtx(),
    )

    expect(res.status).toBe(200)
  })

  it('lets a re-frame MOVE within the frame already published', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }),
    )

    const res = await PUT(
      makeRequest({ cropX: 0.55, cropY: 0.55, cropW: 0.2, cropH: 0.2 }),
      makeCtx(),
    )

    expect(res.status).toBe(200)
  })

  // 🔴 The rule this route exists for. Widening reveals pixels the published
  // frame had removed — the rest of the room, another client, the body below a
  // head crop — and that is a fresh disclosure of somebody's photograph.
  it('REFUSES a re-frame that reaches outside the published frame', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }),
    )

    const res = await PUT(
      makeRequest({ cropX: 0.1, cropY: 0.1, cropW: 0.8, cropH: 0.8 }),
      makeCtx(),
    )

    expect(res.status).toBe(403)
    expect(mocks.mediaAssetUpdateMany).not.toHaveBeenCalled()
  })

  it('REFUSES a sideways move that steps outside the published frame', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }),
    )

    const res = await PUT(
      makeRequest({ cropX: 0.05, cropY: 0.3, cropW: 0.2, cropH: 0.2 }),
      makeCtx(),
    )

    expect(res.status).toBe(403)
    expect(mocks.mediaAssetUpdateMany).not.toHaveBeenCalled()
  })

  // A malformed rect must NOT degrade to "no crop" the way the create paths do:
  // clearing the rect widens the frame back to the whole photo, which is the
  // exact move this route refuses.
  it.each([
    ['a partial rect', { cropX: 0.1, cropY: 0.2, cropW: 0.5 }],
    ['a non-numeric coordinate', { cropX: '0.1', cropY: 0.2, cropW: 0.5, cropH: 0.6 }],
    ['a rect off the edge of the image', { cropX: 0.7, cropY: 0.2, cropW: 0.5, cropH: 0.6 }],
    ['a zero-extent rect', { cropX: 0.1, cropY: 0.2, cropW: 0, cropH: 0.6 }],
    ['an empty body', {}],
  ])('rejects %s with a 400 rather than clearing the crop', async (_label, body) => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }),
    )

    const res = await PUT(makeRequest(body), makeCtx())

    expect(res.status).toBe(400)
    expect(mocks.mediaAssetUpdateMany).not.toHaveBeenCalled()
  })

  // ── The undo window (item 4) ───────────────────────────────────────────────
  //
  // Tori's decision: a pro may put their own crop back for 24h, or until the
  // look is viewed by anyone. Enforced HERE, at the write — a UI that forgets
  // the window must not be able to widen a frame, and a UI that forgets to
  // offer the undo must not be what makes it impossible.

  it('lets a pro widen back to the pre-narrowing frame while the window is open', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, MediaType.IMAGE, {
        undoBound: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
        undoExpiresAt: OPEN_UNTIL(),
        undoViewBaseline: 0,
      }),
    )

    // Outside the STORED rect, inside the frame that stood before it. Without
    // the window this is the 403 above.
    const res = await PUT(
      makeRequest({ cropX: 0.1, cropY: 0.1, cropW: 0.8, cropH: 0.8 }),
      makeCtx(),
    )

    expect(res.status).toBe(200)
  })

  it('REFUSES a widen past the pre-narrowing frame even with the window open', async () => {
    // 🔴 The window is an undo, not an escape hatch. Reaching past where the pro
    // was already allowed is still a fresh disclosure of the client's photo.
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, MediaType.IMAGE, {
        undoBound: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
        undoExpiresAt: OPEN_UNTIL(),
        undoViewBaseline: 0,
      }),
    )

    const res = await PUT(
      makeRequest({ cropX: 0, cropY: 0, cropW: 1, cropH: 1 }),
      makeCtx(),
    )

    expect(res.status).toBe(403)
    expect(mocks.mediaAssetUpdateMany).not.toHaveBeenCalled()
  })

  it('REFUSES the same widen once the window has expired', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, MediaType.IMAGE, {
        undoBound: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
        undoExpiresAt: ALREADY_EXPIRED(),
        undoViewBaseline: 0,
      }),
    )

    const res = await PUT(
      makeRequest({ cropX: 0.1, cropY: 0.1, cropW: 0.8, cropH: 0.8 }),
      makeCtx(),
    )

    expect(res.status).toBe(403)
  })

  it('REFUSES the same widen once somebody has viewed the look', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, MediaType.IMAGE, {
        undoBound: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
        undoExpiresAt: OPEN_UNTIL(),
        undoViewBaseline: 4,
        // One more view than the window was opened with — on a SECONDARY look,
        // which counts: "viewed by anyone" is about the asset, not one post.
        primaryViews: [4],
        secondaryViews: [1],
      }),
    )

    const res = await PUT(
      makeRequest({ cropX: 0.1, cropY: 0.1, cropW: 0.8, cropH: 0.8 }),
      makeCtx(),
    )

    expect(res.status).toBe(403)
  })

  it('opens a window around the frame it enforced against', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, MediaType.IMAGE, {
        primaryViews: [12],
      }),
    )

    const res = await PUT(
      makeRequest({ cropX: 0.4, cropY: 0.4, cropW: 0.2, cropH: 0.2 }),
      makeCtx(),
    )

    expect(res.status).toBe(200)

    const call = mocks.mediaAssetUpdateMany.mock.calls[0]
    if (!call) throw new Error('expected a write')
    const data = call[0].data as Record<string, unknown>

    // The pro can return to exactly where they were allowed a moment ago.
    expect(data.cropUndoBoundX).toBe(0.1)
    expect(data.cropUndoBoundW).toBe(0.8)
    expect(data.cropUndoViewBaseline).toBe(12)
    expect(data.cropUndoExpiresAt).toBeInstanceOf(Date)
  })

  it('does NOT refresh a window that is already open', async () => {
    // 🔴 The anti-ratchet rule at the write. Refreshing on every save would let a
    // pro hold the bound open forever by re-cropping every 23 hours.
    const expiry = OPEN_UNTIL()
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, MediaType.IMAGE, {
        undoBound: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
        undoExpiresAt: expiry,
        undoViewBaseline: 0,
      }),
    )

    const res = await PUT(
      makeRequest({ cropX: 0.45, cropY: 0.45, cropW: 0.1, cropH: 0.1 }),
      makeCtx(),
    )

    expect(res.status).toBe(200)

    const call = mocks.mediaAssetUpdateMany.mock.calls[0]
    if (!call) throw new Error('expected a write')
    const data = call[0].data as Record<string, unknown>

    expect(data).not.toHaveProperty('cropUndoExpiresAt')
    expect(data).not.toHaveProperty('cropUndoBoundX')
    expect(data).not.toHaveProperty('cropUndoViewBaseline')
  })

  it('refuses another pro’s media', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue({
      ...ownedAsset(null),
      professionalId: 'pro_2',
    })

    const res = await PUT(
      makeRequest({ cropX: 0.1, cropY: 0.2, cropW: 0.5, cropH: 0.6 }),
      makeCtx(),
    )

    expect(res.status).toBe(403)
    expect(mocks.mediaAssetUpdateMany).not.toHaveBeenCalled()
  })

  it('404s on media that does not exist', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(null)

    const res = await PUT(
      makeRequest({ cropX: 0.1, cropY: 0.2, cropW: 0.5, cropH: 0.6 }),
      makeCtx(),
    )

    expect(res.status).toBe(404)
  })

  it('refuses a video — nothing honors a rect on one, so storing it would lie', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset(null, MediaType.VIDEO),
    )

    const res = await PUT(
      makeRequest({ cropX: 0.1, cropY: 0.2, cropW: 0.5, cropH: 0.6 }),
      makeCtx(),
    )

    expect(res.status).toBe(400)
    expect(mocks.mediaAssetUpdateMany).not.toHaveBeenCalled()
  })

  // The bound is re-checked at EXECUTION, not only at validation: the rect the
  // request was authorized against goes into the WHERE, so a concurrent
  // narrowing cannot be overwritten by a request that was authorized earlier.
  it('scopes the write to the exact rect it was authorized against', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }),
    )

    await PUT(
      makeRequest({ cropX: 0.3, cropY: 0.3, cropW: 0.2, cropH: 0.2 }),
      makeCtx(),
    )

    expect(mocks.mediaAssetUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'media_1',
          professionalId: 'pro_1',
          cropX: 0.2,
          cropY: 0.2,
          cropW: 0.6,
          cropH: 0.6,
        },
      }),
    )
  })

  it('409s when the rect moved underneath the request', async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue(
      ownedAsset({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }),
    )
    mocks.mediaAssetUpdateMany.mockResolvedValue({ count: 0 })

    const res = await PUT(
      makeRequest({ cropX: 0.3, cropY: 0.3, cropW: 0.2, cropH: 0.2 }),
      makeCtx(),
    )

    expect(res.status).toBe(409)
  })

  it('never reaches the database when the caller is not a pro', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: false,
      res: Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 }),
    })

    const res = await PUT(
      makeRequest({ cropX: 0.1, cropY: 0.2, cropW: 0.5, cropH: 0.6 }),
      makeCtx(),
    )

    expect(res.status).toBe(401)
    expect(mocks.mediaAssetFindUnique).not.toHaveBeenCalled()
    expect(mocks.mediaAssetUpdateMany).not.toHaveBeenCalled()
  })
})
