import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  loadConsultAnalysisState: vi.fn(),
  runConsultAnalysis: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))
vi.mock('@/lib/consult/analysisContract', () => ({
  loadConsultAnalysisState: mocks.loadConsultAnalysisState,
  runConsultAnalysis: mocks.runConsultAnalysis,
}))

import { ConsultWriteError } from '@/lib/consult/errors'
import { GET, POST } from './route'

const state = {
  consultId: 'consult_1',
  status: 'ANALYSIS_PENDING',
  schemaVersion: 1,
  promptVersion: 'hair-color-analysis-v1',
  result: null,
}

function request(body: Record<string, unknown>) {
  return new Request('http://test/api/v1/client/consult/consult_1/analysis', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const validBody = {
  idempotencyKey: 'analysis-1',
  schemaVersion: 1,
  promptVersion: 'hair-color-analysis-v1',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClient.mockResolvedValue({
    ok: true,
    clientId: 'client_1',
    user: { id: 'user_1' },
  })
  mocks.loadConsultAnalysisState.mockResolvedValue(state)
})

describe('client consult analysis route', () => {
  it('returns only the bounded owner state from GET', async () => {
    const response = await GET(new Request('http://test'), {
      params: { id: 'consult_1' },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, analysis: state })
    expect(mocks.loadConsultAnalysisState).toHaveBeenCalledWith({
      consultSessionId: 'consult_1',
      clientId: 'client_1',
      actorUserId: 'user_1',
    })
  })

  it('does not read the body before the locked prerequisite boundary invokes it', async () => {
    const req = request(validBody)
    const jsonSpy = vi.spyOn(req, 'json')
    mocks.runConsultAnalysis.mockRejectedValue(
      new ConsultWriteError('AGREEMENTS_REQUIRED', 'stale consent'),
    )
    const response = await POST(req, { params: { id: 'consult_1' } })
    expect(response.status).toBe(409)
    expect(jsonSpy).not.toHaveBeenCalled()
  })

  it('passes only bounded retry fields and returns the canonical result', async () => {
    mocks.runConsultAnalysis.mockImplementation(async (args) => {
      expect(await args.loadInput()).toEqual(validBody)
      expect(args).toMatchObject({
        consultSessionId: 'consult_1',
        clientId: 'client_1',
        actor: { type: 'CLIENT', id: 'user_1' },
      })
      return { state, replayed: true }
    })
    const response = await POST(request(validBody), {
      params: { id: 'consult_1' },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      analysis: state,
      replayed: true,
    })
  })

  it('maps ownership and provider failures to stable non-leaking errors', async () => {
    mocks.runConsultAnalysis.mockRejectedValueOnce(
      new ConsultWriteError('NOT_OWNER', 'private owner detail'),
    )
    const hidden = await POST(request(validBody), {
      params: { id: 'consult_1' },
    })
    expect(hidden.status).toBe(404)
    expect(JSON.stringify(await hidden.json())).not.toContain('owner')

    mocks.runConsultAnalysis.mockRejectedValueOnce(
      new ConsultWriteError('ANALYSIS_UNAVAILABLE', 'anthropic secret'),
    )
    const unavailable = await POST(request(validBody), {
      params: { id: 'consult_1' },
    })
    expect(unavailable.status).toBe(503)
    const serialized = JSON.stringify(await unavailable.json())
    expect(serialized).toContain('CONSULT_ANALYSIS_UNAVAILABLE')
    expect(serialized).not.toContain('anthropic')
  })

  it('does not leak private paths, raw bytes, signed tokens, or provider details through unexpected errors', async () => {
    mocks.runConsultAnalysis.mockRejectedValue(
      new Error('consult-raw/v1/private.jpg aGVsbG8= signed-token provider-secret'),
    )
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await POST(request(validBody), {
      params: { id: 'consult_1' },
    })
    const serialized = JSON.stringify({
      response: await response.json(),
      logs: errorLog.mock.calls,
    })
    expect(response.status).toBe(500)
    expect(serialized).not.toContain('consult-raw')
    expect(serialized).not.toContain('aGVsbG8=')
    expect(serialized).not.toContain('signed-token')
    expect(serialized).not.toContain('provider-secret')
    errorLog.mockRestore()
  })
})
