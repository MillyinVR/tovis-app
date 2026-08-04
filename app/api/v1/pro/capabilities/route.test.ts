// app/api/v1/pro/capabilities/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data?: Record<string, unknown>, init?: number | ResponseInit) => {
      const status = typeof init === 'number' ? init : init?.status
      return Response.json({ ok: true, ...(data ?? {}) }, { status: status ?? 200 })
    },
  )

  const jsonFail = vi.fn((status: number, error: string) => {
    return Response.json({ ok: false, error }, { status })
  })

  return { jsonOk, jsonFail, requirePro: vi.fn() }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  requirePro: mocks.requirePro,
}))

import { GET } from './route'

const ORIGINAL_NO_SHOW = process.env.ENABLE_NO_SHOW_PROTECTION
const ORIGINAL_MIGRATION = process.env.ENABLE_PRO_MIGRATION

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

function asPro() {
  mocks.requirePro.mockResolvedValue({
    ok: true as const,
    professionalId: 'pro_1',
    userId: 'user_1',
    user: {},
  })
}

async function readJson(res: Response) {
  return (await res.json()) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ENABLE_NO_SHOW_PROTECTION
  delete process.env.ENABLE_PRO_MIGRATION
})

afterEach(() => {
  restore('ENABLE_NO_SHOW_PROTECTION', ORIGINAL_NO_SHOW)
  restore('ENABLE_PRO_MIGRATION', ORIGINAL_MIGRATION)
})

describe('GET /api/v1/pro/capabilities', () => {
  // 🔴 THE load-bearing case. Every other surface of these features 404s while
  // its flag is off; this route must ANSWER then, or a native client can only
  // learn the flag by walking the pro into the dead end this endpoint exists to
  // remove. Copy the `if (!flagEnabled()) return jsonFail(404, …)` guard from a
  // sibling route into route.ts and this goes red.
  it('answers 200 with both capabilities false while the flags are off', async () => {
    asPro()

    const res = await GET()
    expect(res.status).toBe(200)

    const body = await readJson(res)
    expect(body.capabilities).toEqual({
      noShowFees: false,
      importFromAnotherApp: false,
    })
  })

  it('reports each capability from its own flag', async () => {
    asPro()
    process.env.ENABLE_NO_SHOW_PROTECTION = '1'

    const body = await readJson(await GET())
    expect(body.capabilities).toEqual({
      noShowFees: true,
      importFromAnotherApp: false,
    })

    process.env.ENABLE_PRO_MIGRATION = 'true'
    const both = await readJson(await GET())
    expect(both.capabilities).toEqual({
      noShowFees: true,
      importFromAnotherApp: true,
    })
  })

  it('returns the auth refusal for a non-pro caller', async () => {
    const refusal = Response.json({ ok: false, error: 'Forbidden.' }, { status: 403 })
    mocks.requirePro.mockResolvedValue({ ok: false as const, res: refusal })

    const res = await GET()
    expect(res.status).toBe(403)
    expect(mocks.jsonOk).not.toHaveBeenCalled()
  })

  // The flag booleans must never leak to an unauthenticated caller — this route
  // is a readout of the deployment's configuration.
  it('does not read the flags before authenticating', async () => {
    process.env.ENABLE_NO_SHOW_PROTECTION = '1'
    process.env.ENABLE_PRO_MIGRATION = '1'
    const refusal = Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
    mocks.requirePro.mockResolvedValue({ ok: false as const, res: refusal })

    const body = await readJson(await GET())
    expect(body.capabilities).toBeUndefined()
  })
})
