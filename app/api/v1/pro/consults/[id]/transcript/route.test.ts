import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }))
vi.mock('@/app/api/_utils', () => ({ requirePro: mocks.auth,
  jsonOk: (body: object) => Response.json({ ok: true, ...body }),
  jsonFail: (status: number, error: string) => Response.json({ ok: false, error }, { status }),
}))
vi.mock('@/lib/consult/proTranscript', () => ({ loadProConsultTranscript: mocks.load }))
import { GET } from './route'
import { ConsultWriteError } from '@/lib/consult/errors'
const request = new Request('http://test/api/v1/pro/consults/c1/transcript?cursor=next')
const context = { params: Promise.resolve({ id: 'c1' }) }
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ ok: true, professionalId: 'p1', user: { id: 'u1' } }) })
it('returns no-store history using authenticated identity and cursor', async () => {
  mocks.load.mockResolvedValue({ consultId: 'c1', events: [], nextCursor: null, historyNote: 'Saved' })
  const result = await GET(request, context)
  expect(result.status).toBe(200)
  expect(result.headers.get('Cache-Control')).toBe('private, no-store')
  expect(mocks.load).toHaveBeenCalledWith({ consultSessionId: 'c1', professionalId: 'p1', actorUserId: 'u1', cursor: 'next' })
})
it('does not read data for unauthenticated requests', async () => {
  mocks.auth.mockResolvedValue({ ok: false, res: new Response(null, { status: 401 }) })
  expect((await GET(request, context)).status).toBe(401)
  expect(mocks.load).not.toHaveBeenCalled()
})
it('does not disclose whether a denied consultation exists', async () => {
  mocks.load.mockRejectedValue(new ConsultWriteError('NOT_FOUND', 'PRIVATE_DETAIL'))
  const result = await GET(request, context)
  expect(result.status).toBe(404)
  expect(await result.text()).not.toContain('PRIVATE_DETAIL')
})
it('distinguishes invalid cursors from unexpected failures without disclosing details', async () => {
  mocks.load.mockRejectedValueOnce(new ConsultWriteError('INVALID_REQUEST', 'PRIVATE_DETAIL'))
  expect((await GET(request, context)).status).toBe(400)
  mocks.load.mockRejectedValueOnce(new Error('PRIVATE_DETAIL'))
  const result = await GET(request, context)
  expect(result.status).toBe(500)
  expect(await result.text()).not.toContain('PRIVATE_DETAIL')
})
