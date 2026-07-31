// app/api/v1/pro/clients/[id]/consent/route.test.ts
//
// K15 (closing K14-B): the pro can no longer CLAIM a link signature.
//
// K14 found this route persisting `proofMethod: CLIENT_TOKEN` verbatim from a
// dropdown that had no link flow behind it — a control that had been lying
// since it shipped. K15 gives that proof method a real producer (the signing
// route behind /client/consent/<token>), and the price of it meaning anything
// is that ONLY that route may write it.
//
// Dropping the option from the dropdown is not enough: the claim would still be
// one curl away. This suite pins the REFUSAL.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientConsentKind, ConsentProofMethod } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data: unknown, status = 200) =>
      new Response(
        JSON.stringify({ ok: true, ...((data as Record<string, unknown>) ?? {}) }),
        { status, headers: { 'content-type': 'application/json' } },
      ),
  )

  const jsonFail = vi.fn(
    (status: number, error: string) =>
      new Response(JSON.stringify({ ok: false, error }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )

  const requirePro = vi.fn()
  const assertProCanViewClient = vi.fn()
  const isClientTechnicalRecordEnabled = vi.fn()
  const encryptedNoteInput = vi.fn(() => null)

  const clientConsentRecord = { create: vi.fn() }
  const consentFormVersion = { findFirst: vi.fn() }
  const booking = { findFirst: vi.fn() }

  return {
    jsonOk,
    jsonFail,
    requirePro,
    assertProCanViewClient,
    isClientTechnicalRecordEnabled,
    encryptedNoteInput,
    prisma: { clientConsentRecord, consentFormVersion, booking },
    clientConsentRecord,
    consentFormVersion,
    booking,
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/app/api/_utils', async () => {
  const actual = await vi.importActual<typeof import('@/app/api/_utils')>(
    '@/app/api/_utils',
  )
  return {
    ...actual,
    jsonOk: mocks.jsonOk,
    jsonFail: mocks.jsonFail,
    requirePro: mocks.requirePro,
  }
})
vi.mock('@/lib/clientVisibility', () => ({
  assertProCanViewClient: mocks.assertProCanViewClient,
}))
vi.mock('@/lib/clients/technicalRecord', () => ({
  isClientTechnicalRecordEnabled: mocks.isClientTechnicalRecordEnabled,
}))
vi.mock('@/lib/security/notesPrivacy', () => ({
  encryptedNoteInput: mocks.encryptedNoteInput,
}))

import { POST } from './route'

const PRO_ID = 'pro_1'
const CLIENT_ID = 'client_1'

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/v1/pro/clients/client_1/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: CLIENT_ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePro.mockResolvedValue({ ok: true, professionalId: PRO_ID })
  mocks.isClientTechnicalRecordEnabled.mockReturnValue(true)
  mocks.assertProCanViewClient.mockResolvedValue({ ok: true })
  mocks.clientConsentRecord.create.mockResolvedValue({ id: 'record_1' })
})

describe('K14-B: proofMethod CLIENT_TOKEN is refused, not merely hidden', () => {
  it('🔴 refuses a hand-typed CLIENT_TOKEN claim and writes NOTHING', async () => {
    const res = await POST(
      request({
        kind: ClientConsentKind.SERVICE_WAIVER,
        proofMethod: ConsentProofMethod.CLIENT_TOKEN,
      }),
      ctx,
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Send the form to the client to record a link signature.',
    })
    expect(mocks.clientConsentRecord.create).not.toHaveBeenCalled()
  })

  it('refuses it in lowercase too — the parser upper-cases before comparing', async () => {
    const res = await POST(
      request({
        kind: ClientConsentKind.SERVICE_WAIVER,
        proofMethod: 'client_token',
      }),
      ctx,
    )

    expect(res.status).toBe(400)
    expect(mocks.clientConsentRecord.create).not.toHaveBeenCalled()
  })

  it('still accepts the two a pro genuinely witnesses', async () => {
    for (const method of [
      ConsentProofMethod.IN_PERSON,
      ConsentProofMethod.PAPER_ON_FILE,
    ]) {
      mocks.clientConsentRecord.create.mockClear()

      const res = await POST(
        request({ kind: ClientConsentKind.SERVICE_WAIVER, proofMethod: method }),
        ctx,
      )

      expect(res.status).toBe(201)
      expect(mocks.clientConsentRecord.create).toHaveBeenCalledTimes(1)
      expect(
        mocks.clientConsentRecord.create.mock.calls[0]?.[0]?.data?.proofMethod,
      ).toBe(method)
    }
  })

  it('a record with no proof method at all is still writable', async () => {
    const res = await POST(
      request({ kind: ClientConsentKind.SERVICE_WAIVER }),
      ctx,
    )

    expect(res.status).toBe(201)
    expect(
      mocks.clientConsentRecord.create.mock.calls[0]?.[0]?.data?.proofMethod,
    ).toBeNull()
  })
})
