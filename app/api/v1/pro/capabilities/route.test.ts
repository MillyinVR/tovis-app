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

import { TECHNICAL_RECORD_PRO_ALLOWLIST } from '@/lib/clients/technicalRecord'

import { GET } from './route'

const FLAG_ENV_KEYS = [
  'ENABLE_NO_SHOW_PROTECTION',
  'ENABLE_PRO_MIGRATION',
  'ENABLE_RECURRING_APPOINTMENTS',
  'ENABLE_CLIENT_TECHNICAL_RECORD',
] as const

const ORIGINALS: Record<(typeof FLAG_ENV_KEYS)[number], string | undefined> = {
  ENABLE_NO_SHOW_PROTECTION: process.env.ENABLE_NO_SHOW_PROTECTION,
  ENABLE_PRO_MIGRATION: process.env.ENABLE_PRO_MIGRATION,
  ENABLE_RECURRING_APPOINTMENTS: process.env.ENABLE_RECURRING_APPOINTMENTS,
  ENABLE_CLIENT_TECHNICAL_RECORD: process.env.ENABLE_CLIENT_TECHNICAL_RECORD,
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

function asPro(professionalId = 'pro_1') {
  mocks.requirePro.mockResolvedValue({
    ok: true as const,
    professionalId,
    userId: 'user_1',
    user: {},
  })
}

async function readJson(res: Response) {
  return (await res.json()) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  FLAG_ENV_KEYS.forEach((key) => delete process.env[key])
})

afterEach(() => {
  FLAG_ENV_KEYS.forEach((key) => restore(key, ORIGINALS[key]))
})

describe('GET /api/v1/pro/capabilities', () => {
  // 🔴 THE load-bearing case. Every other surface of these features 404s while
  // its flag is off; this route must ANSWER then, or a native client can only
  // learn the flag by walking the pro into the dead end this endpoint exists to
  // remove. Copy the `if (!flagEnabled()) return jsonFail(404, …)` guard from a
  // sibling route into route.ts and this goes red.
  it('answers 200 with every capability false while the flags are off', async () => {
    asPro()

    const res = await GET()
    expect(res.status).toBe(200)

    const body = await readJson(res)
    expect(body.capabilities).toEqual({
      noShowFees: false,
      importFromAnotherApp: false,
      recurringAppointments: false,
      clientTechnicalRecord: false,
    })
  })

  it('reports each capability from its own flag', async () => {
    asPro()
    process.env.ENABLE_NO_SHOW_PROTECTION = '1'

    const body = await readJson(await GET())
    expect(body.capabilities).toEqual({
      noShowFees: true,
      importFromAnotherApp: false,
      recurringAppointments: false,
      clientTechnicalRecord: false,
    })

    process.env.ENABLE_PRO_MIGRATION = 'true'
    const two = await readJson(await GET())
    expect(two.capabilities).toEqual({
      noShowFees: true,
      importFromAnotherApp: true,
      recurringAppointments: false,
      clientTechnicalRecord: false,
    })

    process.env.ENABLE_RECURRING_APPOINTMENTS = '1'
    const all = await readJson(await GET())
    expect(all.capabilities).toEqual({
      noShowFees: true,
      importFromAnotherApp: true,
      recurringAppointments: true,
      clientTechnicalRecord: false,
    })
  })

  // 🔴 The regression guard for the per-pro capability. `clientTechnicalRecord`
  // is gated by the global flag OR a per-pro allowlist, so the route has to
  // hand the ACTING pro's id to the resolver. Drop that argument and this is
  // the only test that goes red — the flag-only cases above all still pass,
  // because they resolve to the same false.
  it('resolves clientTechnicalRecord for the acting pro, not the env alone', async () => {
    const allowlisted = TECHNICAL_RECORD_PRO_ALLOWLIST[0]
    // Emptying the allowlist is the documented way to re-darken the feature;
    // that must not read as a failure here.
    if (!allowlisted) return

    asPro(allowlisted)
    const body = await readJson(await GET())
    expect(body.capabilities).toEqual({
      noShowFees: false,
      importFromAnotherApp: false,
      recurringAppointments: false,
      clientTechnicalRecord: true,
    })

    asPro('pro_not_on_the_list')
    const other = await readJson(await GET())
    expect(
      (other.capabilities as Record<string, unknown>).clientTechnicalRecord,
    ).toBe(false)
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
    FLAG_ENV_KEYS.forEach((key) => {
      process.env[key] = '1'
    })
    const refusal = Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
    mocks.requirePro.mockResolvedValue({ ok: false as const, res: refusal })

    const body = await readJson(await GET())
    expect(body.capabilities).toBeUndefined()
  })
})
