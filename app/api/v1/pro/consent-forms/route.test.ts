// app/api/v1/pro/consent-forms/route.test.ts
//
// The READ half of the pro's consent-form library. What the loader does with
// real rows is proved against real Postgres in
// `tests/integration/consent-form-versions.test.ts`; what is only true HERE is
// the route's own jobs: refuse a pro the gate is off for, hand the loader the
// ACTING pro's id, and put the built DTO on the wire.
//
// 🔴 What this file deliberately does NOT claim: that `publishedAt` is converted
// to a string. `JSON.stringify` renders a `Date` as the same ISO text, so no
// test on this side of the wire can tell a converted field from an unconverted
// one. That conversion is proved in `lib/dto/proConsentForms.test.ts`, before
// any serialization happens.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn((data?: Record<string, unknown>, init?: number | ResponseInit) => {
    const status = typeof init === 'number' ? init : init?.status
    return Response.json({ ok: true, ...(data ?? {}) }, { status: status ?? 200 })
  }),
  jsonFail: vi.fn((status: number, error: string) =>
    Response.json({ ok: false, error }, { status }),
  ),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined,
  ),
  requirePro: vi.fn(),
  isClientTechnicalRecordEnabled: vi.fn(),
  loadProConsentFormLibrary: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: mocks.pickString,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/clients/technicalRecord', () => ({
  isClientTechnicalRecordEnabled: mocks.isClientTechnicalRecordEnabled,
}))

vi.mock('@/lib/consentForms/loader', () => ({
  loadProConsentFormLibrary: mocks.loadProConsentFormLibrary,
}))

// Imported only so the route module resolves — GET touches neither.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/consentForms/publish', () => ({
  createConsentFormWithFirstVersion: vi.fn(),
}))

import {
  CONSENT_FORM_BODY_MAX,
  CONSENT_FORM_TITLE_MAX,
} from '@/lib/consentForms/formText'

import { GET } from './route'

const PUBLISHED_AT = new Date('2026-04-02T09:30:00.000Z')

function libraryWithOneForm() {
  return {
    forms: [
      {
        id: 'form_1',
        kind: 'SERVICE_WAIVER',
        isActive: true,
        origin: 'PRO_AUTHORED',
        originLabel: 'Written by you',
        currentVersion: {
          id: 'ver_2',
          version: 2,
          title: 'Corrective colour waiver',
          body: 'I understand corrective colour may take several sessions.',
          publishedAt: PUBLISHED_AT,
          verbatimFromTemplate: false,
        },
        versionCount: 2,
        signatureCount: 3,
      },
    ],
    templates: [
      {
        id: 'tpl_1',
        kind: 'GENERAL_CONSENT',
        isActive: true,
        origin: 'PLATFORM_TEMPLATE',
        originLabel: 'Platform template',
        currentVersion: {
          id: 'tpl_ver_1',
          version: 1,
          title: 'General consent',
          body: 'Agreed terms.',
          publishedAt: PUBLISHED_AT,
          verbatimFromTemplate: true,
        },
        versionCount: 1,
        signatureCount: 0,
        adopted: false,
      },
    ],
  }
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
  asPro()
  mocks.isClientTechnicalRecordEnabled.mockReturnValue(true)
  mocks.loadProConsentFormLibrary.mockResolvedValue(libraryWithOneForm())
})

describe('GET /api/v1/pro/consent-forms', () => {
  it('serves the library for a pro the gate is on for', async () => {
    const res = await GET()
    expect(res.status).toBe(200)

    const body = await readJson(res)
    const forms = body.forms as Record<string, unknown>[]
    expect(forms).toHaveLength(1)
    expect(forms[0]).toMatchObject({
      id: 'form_1',
      kind: 'SERVICE_WAIVER',
      isActive: true,
      origin: 'PRO_AUTHORED',
      originLabel: 'Written by you',
      versionCount: 2,
      signatureCount: 3,
    })

    const templates = body.templates as Record<string, unknown>[]
    expect(templates[0]).toMatchObject({ id: 'tpl_1', adopted: false })
  })

  // The write routes refuse text past these lengths. A client that holds its own
  // copy of them is a client that disagrees with the server the day one moves,
  // so they travel.
  it('carries the limits the write routes enforce', async () => {
    const body = await readJson(await GET())
    expect(body.limits).toEqual({
      titleMax: CONSENT_FORM_TITLE_MAX,
      bodyMax: CONSENT_FORM_BODY_MAX,
    })
  })

  // Same gate, same answer as every write route on this library: with the
  // technical record off for this pro the surface does not exist. 404 rather
  // than an empty list — an empty library is a different fact, and a client
  // would render it as "you have no forms yet".
  it('404s — without reading anything — when the gate is off for this pro', async () => {
    mocks.isClientTechnicalRecordEnabled.mockReturnValue(false)

    const res = await GET()
    expect(res.status).toBe(404)
    expect(mocks.loadProConsentFormLibrary).not.toHaveBeenCalled()
  })

  it('reads the library for the ACTING pro', async () => {
    asPro('pro_42')
    await GET()
    expect(mocks.loadProConsentFormLibrary).toHaveBeenCalledWith('pro_42')
    expect(mocks.isClientTechnicalRecordEnabled).toHaveBeenCalledWith('pro_42')
  })

  it('returns the auth refusal for a non-pro caller, before the gate', async () => {
    const refusal = Response.json({ ok: false, error: 'Forbidden.' }, { status: 403 })
    mocks.requirePro.mockResolvedValue({ ok: false as const, res: refusal })

    const res = await GET()
    expect(res.status).toBe(403)
    expect(mocks.isClientTechnicalRecordEnabled).not.toHaveBeenCalled()
    expect(mocks.loadProConsentFormLibrary).not.toHaveBeenCalled()
  })

  // A loader that throws must not put a stack trace or a Prisma message on the
  // wire — the surrounding catch is what keeps that true.
  it('answers 500 with a plain message when the read fails', async () => {
    mocks.loadProConsentFormLibrary.mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    )
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await GET()
    expect(res.status).toBe(500)
    expect((await readJson(res)).error).toBe('Failed to load forms.')

    spy.mockRestore()
  })
})
