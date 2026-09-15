import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminPermissionRole, Role } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  listLookAnalyses: vi.fn(),
  mutateLookAnalysis: vi.fn(),
  parseLookReview: vi.fn(),
  readReviewFrame: vi.fn(),
  enforceRateLimit: vi.fn(),
  kickNotificationDrain: vi.fn(),
}))
vi.mock('@/app/api/_utils', async () => ({
  ...await import('./responses'),
  requirePro: mocks.requirePro,
}))
vi.mock('./auth/requireUser', () => ({ requireUser: mocks.requireUser }))
vi.mock('./auth/requireAdminPermission', () => ({ requireAdminPermission: mocks.requireAdminPermission }))
vi.mock('@/lib/rateLimit/enforce', () => ({ enforceRateLimit: mocks.enforceRateLimit }))
vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({ kickNotificationDrain: mocks.kickNotificationDrain }))
vi.mock('@/lib/looks/analysis/review', () => ({
  listLookAnalyses: mocks.listLookAnalyses,
  mutateLookAnalysis: mocks.mutateLookAnalysis,
  parseLookReview: mocks.parseLookReview,
  readReviewFrame: mocks.readReviewFrame,
  LookAnalysisError: class extends Error {
    constructor(public readonly status: number, message: string) { super(message) }
  },
}))

import { LookAnalysisError } from '@/lib/looks/analysis/review'
import { lookAnalysisFrame, lookAnalysisList, lookAnalysisMutation } from './lookAnalysis'

const mutation = { revision: 7, action: 'answer', answers: { extensions: 'NO' } }
function request() {
  return new Request('http://localhost/api/v1/pro/looks/analysis/reading-1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation),
  })
}
const operations = {
  list: (admin: boolean) => lookAnalysisList(admin),
  mutation: (admin: boolean) => lookAnalysisMutation(request(), { params: Promise.resolve({ id: 'reading-1' }) }, admin),
  frame: (admin: boolean) => lookAnalysisFrame({ params: Promise.resolve({ id: 'reading-1', frame: '1' }) }, admin),
}
function expectNoReviewAccess() {
  expect(mocks.listLookAnalyses).not.toHaveBeenCalled()
  expect(mocks.mutateLookAnalysis).not.toHaveBeenCalled()
  expect(mocks.readReviewFrame).not.toHaveBeenCalled()
  expect(mocks.parseLookReview).not.toHaveBeenCalled()
  expect(mocks.kickNotificationDrain).not.toHaveBeenCalled()
  expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({ ok: true, user: { id: 'pro-user' }, professionalId: 'pro-profile' })
  mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin-user' } })
  mocks.requireAdminPermission.mockResolvedValue({ ok: true })
  mocks.enforceRateLimit.mockResolvedValue({ allowed: true })
  mocks.listLookAnalyses.mockResolvedValue([])
  mocks.mutateLookAnalysis.mockResolvedValue(undefined)
  mocks.parseLookReview.mockReturnValue(mutation)
  mocks.readReviewFrame.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]))
})

describe('look review API authorization', () => {
  describe.each(Object.entries(operations))('%s', (_name, invoke) => {
    it.each([
      { status: 401, reason: 'Not signed in' },
      { status: 403, reason: 'Professional profile required' },
    ])('returns pro authorization denial $status before review access', async ({ status, reason }) => {
      const denied = new Response(reason, { status })
      mocks.requirePro.mockResolvedValue({ ok: false, res: denied })
      expect(await invoke(false)).toBe(denied)
      expect(mocks.requirePro).toHaveBeenCalledOnce()
      expect(mocks.requireUser).not.toHaveBeenCalled()
      expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
      expectNoReviewAccess()
    })

    it('rejects the wrong admin role before checking permissions or review storage', async () => {
      const denied = new Response('Forbidden', { status: 403 })
      mocks.requireUser.mockResolvedValue({ ok: false, res: denied })
      expect(await invoke(true)).toBe(denied)
      expect(mocks.requireUser).toHaveBeenCalledWith({ roles: [Role.ADMIN] })
      expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
      expect(mocks.requirePro).not.toHaveBeenCalled()
      expectNoReviewAccess()
    })

    it('requires SUPER_ADMIN permission before review access', async () => {
      const denied = new Response('Forbidden', { status: 403 })
      mocks.requireAdminPermission.mockResolvedValue({ ok: false, res: denied })
      expect(await invoke(true)).toBe(denied)
      expect(mocks.requireUser).toHaveBeenCalledWith({ roles: [Role.ADMIN] })
      expect(mocks.requireAdminPermission).toHaveBeenCalledWith({ adminUserId: 'admin-user', allowedRoles: [AdminPermissionRole.SUPER_ADMIN] })
      expectNoReviewAccess()
    })
  })

  it.each([false, true])('passes the authenticated scope to list, mutation, and frame (admin=%s)', async admin => {
    const scope = admin ? { actorUserId: 'admin-user', professionalId: null, admin: true } : { actorUserId: 'pro-user', professionalId: 'pro-profile', admin: false }
    await operations.list(admin)
    await operations.mutation(admin)
    await operations.frame(admin)
    expect(mocks.listLookAnalyses).toHaveBeenCalledWith(scope)
    expect(mocks.mutateLookAnalysis).toHaveBeenCalledWith(scope, 'reading-1', mutation)
    expect(mocks.readReviewFrame).toHaveBeenCalledWith(scope, 'reading-1', 1)
    expect(mocks.parseLookReview).toHaveBeenCalledWith(mutation)
    expect(mocks.kickNotificationDrain).toHaveBeenCalledOnce()
  })

  it('does not consume mutation JSON before authorization', async () => {
    const input = request()
    const bodyRead = vi.spyOn(input, 'text')
    mocks.requirePro.mockResolvedValue({ ok: false, res: new Response(null, { status: 401 }) })
    const result = await lookAnalysisMutation(input, { params: { id: 'reading-1' } }, false)
    expect(result.status).toBe(401)
    expect(bodyRead).not.toHaveBeenCalled()
    expectNoReviewAccess()
  })

  it('authorizes and rate limits before allowing mutation storage access', async () => {
    await operations.mutation(true)
    const roleOrder = mocks.requireUser.mock.invocationCallOrder[0]!
    const permissionOrder = mocks.requireAdminPermission.mock.invocationCallOrder[0]!
    const limitOrder = mocks.enforceRateLimit.mock.invocationCallOrder[0]!
    const writeOrder = mocks.mutateLookAnalysis.mock.invocationCallOrder[0]!
    expect(roleOrder).toBeLessThan(permissionOrder)
    expect(permissionOrder).toBeLessThan(limitOrder)
    expect(limitOrder).toBeLessThan(writeOrder)
  })

  it('propagates a stale revision as 409 and does not trigger notification delivery', async () => {
    mocks.mutateLookAnalysis.mockRejectedValue(new LookAnalysisError(409, 'Reading changed'))
    const result = await operations.mutation(false)
    expect(result.status).toBe(409)
    expect(await result.json()).toMatchObject({ ok: false, error: 'Reading changed' })
    expect(mocks.kickNotificationDrain).not.toHaveBeenCalled()
  })

  it('returns authorized frame bytes with private no-store and nosniff headers', async () => {
    const result = await operations.frame(false)
    expect(result.status).toBe(200)
    expect(result.headers.get('Cache-Control')).toBe('private, no-store')
    expect(result.headers.get('Content-Type')).toBe('image/jpeg')
    expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]))
  })

  it.each(['-1', '3', '01', '1.0', '../0'])('refuses invalid frame %s before reading bytes', async frame => {
    const result = await lookAnalysisFrame({ params: { id: 'reading-1', frame } }, false)
    expect(result.status).toBe(404)
    expect(mocks.readReviewFrame).not.toHaveBeenCalled()
  })
})
