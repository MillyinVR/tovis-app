// app/api/v1/public/claim/[token]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn((data?: Record<string, unknown>) => ({ ok: true, ...data })),
  jsonFail: vi.fn(
    (status: number, error: string, extra?: Record<string, unknown>) => ({
      ok: false,
      status,
      error,
      ...extra,
    }),
  ),
  pickString: vi.fn(),
  enforceRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),
  tokenRateLimitIdentity: vi.fn(),
  getClientClaimLinkPublicState: vi.fn(),
  normalizeProClientInviteToken: vi.fn(),
  hashProClientInviteToken: vi.fn(),
  buildClaimLocationLabel: vi.fn(),
  buildClaimProfessionalLabel: vi.fn(),
  resolveClaimBookingTimeZone: vi.fn(),
  resolveClaimProfessionalName: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: mocks.pickString,
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
  tokenRateLimitIdentity: mocks.tokenRateLimitIdentity,
}))

vi.mock('@/lib/clients/clientClaimLinks', () => ({
  getClientClaimLinkPublicState: mocks.getClientClaimLinkPublicState,
}))

vi.mock('@/lib/clients/proClientInviteTokens', () => ({
  normalizeProClientInviteToken: mocks.normalizeProClientInviteToken,
  hashProClientInviteToken: mocks.hashProClientInviteToken,
}))

vi.mock('@/lib/clients/claimPublicView', () => ({
  buildClaimLocationLabel: mocks.buildClaimLocationLabel,
  buildClaimProfessionalLabel: mocks.buildClaimProfessionalLabel,
  resolveClaimBookingTimeZone: mocks.resolveClaimBookingTimeZone,
  resolveClaimProfessionalName: mocks.resolveClaimProfessionalName,
}))

import { GET } from './route'

function makeCtx(token = 'token_1') {
  return { params: Promise.resolve({ token }) }
}

function makeLink(overrides?: Record<string, unknown>) {
  return {
    invitedName: 'Tori Morales',
    invitedEmail: 'tori@example.com',
    invitedPhone: '+16195551234',
    booking: {
      service: { name: 'Balayage' },
      scheduledFor: new Date('2026-05-01T17:00:00.000Z'),
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pickString.mockImplementation((v: unknown) =>
    typeof v === 'string' ? v : null,
  )
  mocks.normalizeProClientInviteToken.mockImplementation((v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null,
  )
  mocks.hashProClientInviteToken.mockReturnValue('hashhashhashhashhash')
  mocks.enforceRateLimit.mockResolvedValue(null)
  mocks.rateLimitIdentity.mockResolvedValue({ kind: 'ip', id: '203.0.113.5' })
  mocks.tokenRateLimitIdentity.mockReturnValue({ kind: 'token', id: 'hashhashhashhash' })
  mocks.buildClaimLocationLabel.mockReturnValue('Studio A, San Diego')
  mocks.buildClaimProfessionalLabel.mockReturnValue('Glow Studio')
  mocks.resolveClaimBookingTimeZone.mockReturnValue('America/Los_Angeles')
  mocks.resolveClaimProfessionalName.mockReturnValue('Glow Studio')
  mocks.getClientClaimLinkPublicState.mockResolvedValue({
    kind: 'ready',
    link: makeLink(),
  })
})

describe('GET /api/v1/public/claim/[token]', () => {
  it('returns 404 when the token is missing/blank', async () => {
    mocks.normalizeProClientInviteToken.mockReturnValueOnce(null)

    const res = await GET(new Request('http://localhost'), makeCtx('   '))

    expect(res).toMatchObject({ ok: false, status: 404, code: 'NOT_FOUND' })
    expect(mocks.getClientClaimLinkPublicState).not.toHaveBeenCalled()
  })

  it('returns the IP rate-limit response before any lookup', async () => {
    const limited = { ok: false, status: 429 }
    mocks.enforceRateLimit.mockResolvedValueOnce(limited)

    const res = await GET(new Request('http://localhost'), makeCtx())

    expect(res).toBe(limited)
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'account-invite:mint',
      identity: { kind: 'ip', id: '203.0.113.5' },
    })
    expect(mocks.getClientClaimLinkPublicState).not.toHaveBeenCalled()
  })

  it('returns the token-prefix rate-limit response before any lookup', async () => {
    const limited = { ok: false, status: 429 }
    mocks.enforceRateLimit.mockResolvedValueOnce(null).mockResolvedValueOnce(limited)

    const res = await GET(new Request('http://localhost'), makeCtx())

    expect(res).toBe(limited)
    expect(mocks.enforceRateLimit).toHaveBeenLastCalledWith({
      bucket: 'account-invite:mint:token',
      identity: { kind: 'token', id: 'hashhashhashhash' },
    })
    expect(mocks.getClientClaimLinkPublicState).not.toHaveBeenCalled()
  })

  it('returns 404 when the claim link is not found', async () => {
    mocks.getClientClaimLinkPublicState.mockResolvedValueOnce({
      kind: 'not_found',
    })

    const res = await GET(new Request('http://localhost'), makeCtx())

    expect(res).toMatchObject({ ok: false, status: 404, code: 'NOT_FOUND' })
  })

  it('returns the ready claim view with booking context and invited contact', async () => {
    const res = await GET(new Request('http://localhost'), makeCtx())

    expect(res).toMatchObject({
      ok: true,
      state: 'ready',
      invitedName: 'Tori Morales',
      invitedEmail: 'tori@example.com',
      invitedPhone: '+16195551234',
      professionalName: 'Glow Studio',
      booking: {
        serviceName: 'Balayage',
        professionalName: 'Glow Studio',
        scheduledFor: '2026-05-01T17:00:00.000Z',
        timeZone: 'America/Los_Angeles',
        locationLabel: 'Studio A, San Diego',
      },
    })
  })

  it('returns a booking-less claim (200, booking: null) instead of 404', async () => {
    mocks.getClientClaimLinkPublicState.mockResolvedValueOnce({
      kind: 'ready',
      link: makeLink({ booking: null }),
    })
    mocks.resolveClaimProfessionalName.mockReturnValueOnce(null)

    const res = await GET(new Request('http://localhost'), makeCtx())

    expect(res).toMatchObject({
      ok: true,
      state: 'ready',
      invitedName: 'Tori Morales',
      professionalName: null,
      booking: null,
    })
  })

  it('maps a revoked state', async () => {
    mocks.getClientClaimLinkPublicState.mockResolvedValueOnce({
      kind: 'revoked',
      link: makeLink(),
    })

    const res = await GET(new Request('http://localhost'), makeCtx())

    expect(res).toMatchObject({ ok: true, state: 'revoked' })
  })

  it('maps an already-claimed state', async () => {
    mocks.getClientClaimLinkPublicState.mockResolvedValueOnce({
      kind: 'already_claimed',
      link: makeLink(),
    })

    const res = await GET(new Request('http://localhost'), makeCtx())

    expect(res).toMatchObject({ ok: true, state: 'already_claimed' })
  })

  it('returns null scheduledFor when the booking has no scheduled time', async () => {
    mocks.getClientClaimLinkPublicState.mockResolvedValueOnce({
      kind: 'ready',
      link: makeLink({
        booking: { service: { name: 'Consult' }, scheduledFor: null },
      }),
    })

    const res = await GET(new Request('http://localhost'), makeCtx())

    expect(res).toMatchObject({
      ok: true,
      booking: { serviceName: 'Consult', scheduledFor: null },
    })
  })
})
