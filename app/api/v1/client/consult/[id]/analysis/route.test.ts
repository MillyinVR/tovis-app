import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  loadConsultAnalysisState: vi.fn(),
  startConsultAnalysis: vi.fn(),
  kickConsultAnalysisRun: vi.fn(),
  enforceRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))
vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}))
vi.mock('@/lib/consult/analysisContract', async (importOriginal) => {
  // The P2028 translator is REAL here on purpose: the point of the
  // transaction-expired test below is that a Prisma error becomes a named,
  // retryable refusal, and a mocked translator would prove only that the mock
  // returns what the mock was told to.
  const original =
    await importOriginal<typeof import('@/lib/consult/analysisContract')>()
  return {
    asConsultAnalysisTransactionError: original.asConsultAnalysisTransactionError,
    loadConsultAnalysisState: mocks.loadConsultAnalysisState,
    startConsultAnalysis: mocks.startConsultAnalysis,
  }
})
vi.mock('@/lib/consult/analysisRunner', () => ({
  kickConsultAnalysisRun: mocks.kickConsultAnalysisRun,
}))

import { Prisma } from '@prisma/client'

import { ConsultWriteError } from '@/lib/consult/errors'
import { GET, POST } from './route'

const state = {
  consultId: 'consult_1',
  status: 'ANALYSIS_PENDING',
  schemaVersion: 1,
  promptVersion: 'hair-color-analysis-v1',
  result: null,
  run: null,
}

const run = {
  runId: 'run_1',
  status: 'QUEUED' as const,
  stage: 'QUEUED' as const,
  photoCount: 4,
  attemptCount: 0,
  maxAttempts: 3,
  queuedAt: '2026-09-04T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  failureCode: null,
  retryable: false,
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
  mocks.rateLimitIdentity.mockResolvedValue({ kind: 'user', id: 'user_1' })
  mocks.enforceRateLimit.mockResolvedValue(null)
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
    // Reads are deliberately not rate limited; only the paid POST is.
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
  })

  it('refuses a rate-limited POST on the vision bucket before the paid boundary runs', async () => {
    const limited = new Response('slow down', { status: 429 })
    mocks.enforceRateLimit.mockResolvedValue(limited)

    expect(await POST(request(validBody), { params: { id: 'consult_1' } })).toBe(
      limited,
    )
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'client:consult:vision',
      identity: { kind: 'user', id: 'user_1' },
    })
    expect(mocks.startConsultAnalysis).not.toHaveBeenCalled()
  })

  it('does not read the body before the locked prerequisite boundary invokes it', async () => {
    const req = request(validBody)
    const jsonSpy = vi.spyOn(req, 'json')
    mocks.startConsultAnalysis.mockRejectedValue(
      new ConsultWriteError('AGREEMENTS_REQUIRED', 'stale consent'),
    )
    const response = await POST(req, { params: { id: 'consult_1' } })
    expect(response.status).toBe(409)
    expect(jsonSpy).not.toHaveBeenCalled()
  })

  it('passes only bounded retry fields and returns the canonical result', async () => {
    mocks.startConsultAnalysis.mockImplementation(async (args) => {
      expect(await args.loadInput()).toEqual(validBody)
      expect(args).toMatchObject({
        consultSessionId: 'consult_1',
        clientId: 'client_1',
        actor: { type: 'CLIENT', id: 'user_1' },
      })
      return { state, run, replayed: false }
    })
    const response = await POST(request(validBody), {
      params: { id: 'consult_1' },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      analysis: state,
      replayed: false,
    })
    // P4b: the start request schedules the work rather than doing it. Without
    // the kick the client waits for the next cron tick, which is the whole
    // regression this assertion exists to catch.
    expect(mocks.kickConsultAnalysisRun).toHaveBeenCalledTimes(1)
  })

  it('does not kick a replayed start — the run is already live or already done', async () => {
    // A double-tap, a re-mounted screen, or a resumed app. Kicking here would
    // schedule a second worker against a run that is already claimed; harmless
    // but wasteful, and it muddies "one kick per run started".
    mocks.startConsultAnalysis.mockResolvedValue({
      state,
      run,
      replayed: true,
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
    expect(mocks.kickConsultAnalysisRun).not.toHaveBeenCalled()
  })

  it('translates a raw Prisma P2028 into the same named refusal', async () => {
    // 🔴 The path that actually happens in production: nothing throws a tidy
    // ConsultWriteError, Prisma throws P2028. Before P4b that reached the
    // client as `500 Internal server error` — no code, no advice, no retry.
    mocks.startConsultAnalysis.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Transaction already closed: A query cannot be executed on an expired transaction.',
        { code: 'P2028', clientVersion: 'test' },
      ),
    )
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await POST(request(validBody), {
      params: { id: 'consult_1' },
    })
    expect(response.status).toBe(503)
    const serialized = JSON.stringify(await response.json())
    expect(serialized).toContain('CONSULT_ANALYSIS_TRANSACTION_EXPIRED')
    expect(serialized).not.toContain('P2028')
    errorLog.mockRestore()
  })

  it('surfaces an expired analysis transaction as a retryable 503, not a bare 500', async () => {
    // 🔴 P2028 was the single most likely way a real analysis died before P4b
    // (a 115s transaction budget wrapped around a 245s provider budget), and it
    // reached the client as `500 Internal server error` — no code, no advice,
    // no retry. It must never go back to being anonymous.
    mocks.startConsultAnalysis.mockRejectedValue(
      new ConsultWriteError('ANALYSIS_TRANSACTION_EXPIRED', 'P2028 detail'),
    )
    const response = await POST(request(validBody), {
      params: { id: 'consult_1' },
    })
    expect(response.status).toBe(503)
    const serialized = JSON.stringify(await response.json())
    expect(serialized).toContain('CONSULT_ANALYSIS_TRANSACTION_EXPIRED')
    expect(serialized).not.toContain('P2028')
  })

  it('maps ownership and provider failures to stable non-leaking errors', async () => {
    mocks.startConsultAnalysis.mockRejectedValueOnce(
      new ConsultWriteError('NOT_OWNER', 'private owner detail'),
    )
    const hidden = await POST(request(validBody), {
      params: { id: 'consult_1' },
    })
    expect(hidden.status).toBe(404)
    expect(JSON.stringify(await hidden.json())).not.toContain('owner')

    mocks.startConsultAnalysis.mockRejectedValueOnce(
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
    mocks.startConsultAnalysis.mockRejectedValue(
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
