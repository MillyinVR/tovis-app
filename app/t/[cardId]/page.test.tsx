// app/t/[cardId]/page.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NfcCardType } from '@prisma/client'

const TEST_NOW = new Date('2026-04-12T12:00:00.000Z')

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getCurrentUser: vi.fn(),
  nfcCardFindUnique: vi.fn(),
  professionalProfileFindUnique: vi.fn(),
  tapIntentCreate: vi.fn(),
  isWithinRateLimit: vi.fn(),
  isNonInteractive: vi.fn(),
  recordTapEvent: vi.fn(),
  consumeTapIntent: vi.fn(),
  checkReadiness: vi.fn(),
  headers: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

vi.mock('next/headers', () => ({
  headers: mocks.headers,
}))

vi.mock('@/lib/currentUser', () => ({
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    nfcCard: {
      findUnique: mocks.nfcCardFindUnique,
    },
    professionalProfile: {
      findUnique: mocks.professionalProfileFindUnique,
    },
    tapIntent: {
      create: mocks.tapIntentCreate,
    },
  },
}))

vi.mock('@/lib/nfc/tapRateLimit', () => ({
  isNfcTapWithinRateLimit: mocks.isWithinRateLimit,
}))

vi.mock('@/lib/nfc/tapRequest', () => ({
  isNonInteractiveTapRequest: mocks.isNonInteractive,
}))

vi.mock('@/lib/nfc/attributionEvents', () => ({
  recordNfcCardTappedEvent: mocks.recordTapEvent,
  // The page only imports the recorder; constants are unused here.
  NFC_ATTRIBUTION_EVENT: {},
}))

vi.mock('@/lib/tapIntentConsume', () => ({
  consumeTapIntent: mocks.consumeTapIntent,
}))

vi.mock('@/lib/pro/readiness/proReadiness', () => ({
  checkProReadinessForEntryPoint: mocks.checkReadiness,
}))

import TapPage from './page'

function makeCard(overrides?: {
  id?: string
  type?: NfcCardType
  isActive?: boolean
  claimedAt?: Date | null
  professionalId?: string | null
  tenantSlug?: string
}) {
  return {
    id: overrides?.id ?? 'card_1',
    type: overrides?.type ?? NfcCardType.UNASSIGNED,
    isActive: overrides?.isActive ?? true,
    claimedAt: overrides && 'claimedAt' in overrides ? overrides.claimedAt : null,
    professionalId:
      overrides && 'professionalId' in overrides ? overrides.professionalId : null,
    tenant: { slug: overrides?.tenantSlug ?? 'tovis-root' },
  }
}

function makeUser(overrides?: { id?: string }) {
  return { id: overrides?.id ?? 'user_1', role: 'CLIENT' }
}

async function renderPage(args?: {
  cardId?: string
  searchParams?: Record<string, string | undefined>
}) {
  const props: Parameters<typeof TapPage>[0] = {
    params: Promise.resolve({ cardId: args?.cardId ?? 'card_1' }),
  }
  if (args?.searchParams) {
    props.searchParams = Promise.resolve(args.searchParams)
  }
  return TapPage(props)
}

describe('app/t/[cardId]/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.redirect.mockImplementation((href: string) => {
      throw new Error(`REDIRECT:${href}`)
    })

    mocks.isWithinRateLimit.mockResolvedValue(true)
    mocks.isNonInteractive.mockReturnValue(false)
    mocks.headers.mockResolvedValue({ get: () => null })
    mocks.recordTapEvent.mockResolvedValue(undefined)
    mocks.consumeTapIntent.mockResolvedValue({ ok: true, nextUrl: '/looks' })
    mocks.checkReadiness.mockResolvedValue({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_1'],
    })

    mocks.getCurrentUser.mockResolvedValue(null)
    mocks.nfcCardFindUnique.mockResolvedValue(makeCard())
    mocks.professionalProfileFindUnique.mockResolvedValue({
      id: 'pro_1',
      handleNormalized: 'tovis-studio',
      isPremium: true,
    })
    mocks.tapIntentCreate.mockResolvedValue({ id: 'tap_intent_1' })
  })

  it('redirects to the rate-limit page and skips work when over the limit', async () => {
    mocks.isWithinRateLimit.mockResolvedValueOnce(false)

    await expect(renderPage()).rejects.toThrow('REDIRECT:/nfc/invalid?reason=rate')

    expect(mocks.nfcCardFindUnique).not.toHaveBeenCalled()
    expect(mocks.tapIntentCreate).not.toHaveBeenCalled()
  })

  it('redirects to invalid when card does not exist', async () => {
    mocks.nfcCardFindUnique.mockResolvedValueOnce(null)

    await expect(renderPage()).rejects.toThrow('REDIRECT:/nfc/invalid')
    expect(mocks.tapIntentCreate).not.toHaveBeenCalled()
  })

  it('redirects to invalid when card is inactive', async () => {
    mocks.nfcCardFindUnique.mockResolvedValueOnce(makeCard({ isActive: false }))

    await expect(renderPage()).rejects.toThrow('REDIRECT:/nfc/invalid')
    expect(mocks.tapIntentCreate).not.toHaveBeenCalled()
  })

  it('skips the tap write and redirects for non-interactive (bot/prefetch) requests', async () => {
    mocks.isNonInteractive.mockReturnValueOnce(true)
    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({ id: 'card_unclaimed_1', type: NfcCardType.UNASSIGNED }),
    )

    await expect(renderPage({ cardId: 'card_unclaimed_1' })).rejects.toThrow(
      'REDIRECT:/signup',
    )

    expect(mocks.tapIntentCreate).not.toHaveBeenCalled()
    expect(mocks.recordTapEvent).not.toHaveBeenCalled()
  })

  it('creates a CLAIM_CARD intent (empty payload) and sends an anon user to signup with ti', async () => {
    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({ id: 'card_unclaimed_1', type: NfcCardType.UNASSIGNED }),
    )

    await expect(renderPage({ cardId: 'card_unclaimed_1' })).rejects.toThrow(
      'REDIRECT:/signup?ti=tap_intent_1',
    )

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_unclaimed_1',
        userId: null,
        intentType: 'CLAIM_CARD',
        payloadJson: {},
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: { id: true },
    })
    expect(mocks.recordTapEvent).toHaveBeenCalledTimes(1)
    expect(mocks.consumeTapIntent).not.toHaveBeenCalled()
  })

  it('consumes the intent for a logged-in tapper and redirects to the consumed nextUrl', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(makeUser())
    mocks.consumeTapIntent.mockResolvedValueOnce({ ok: true, nextUrl: '/looks' })
    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({ id: 'card_unclaimed_1', type: NfcCardType.UNASSIGNED }),
    )

    await expect(renderPage({ cardId: 'card_unclaimed_1' })).rejects.toThrow(
      'REDIRECT:/looks',
    )

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_unclaimed_1',
        userId: 'user_1',
        intentType: 'CLAIM_CARD',
        payloadJson: {},
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: { id: true },
    })
    expect(mocks.consumeTapIntent).toHaveBeenCalledWith({
      tapIntentId: 'tap_intent_1',
      userId: 'user_1',
    })
  })

  it('creates a BOOK_PRO intent for a premium pro and sends an anon user to the handle page', async () => {
    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_pro_1',
        type: NfcCardType.PRO_BOOKING,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
        professionalId: 'pro_1',
      }),
    )

    await expect(renderPage({ cardId: 'card_pro_1' })).rejects.toThrow(
      'REDIRECT:/p/tovis-studio?ti=tap_intent_1',
    )

    expect(mocks.checkReadiness).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      entryPoint: 'NFC_CARD',
    })
    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_pro_1',
        userId: null,
        intentType: 'BOOK_PRO',
        payloadJson: { professionalId: 'pro_1', nextUrl: '/p/tovis-studio' },
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: { id: true },
    })
  })

  it('routes a non-premium pro card to the professionals page', async () => {
    mocks.professionalProfileFindUnique.mockResolvedValueOnce({
      id: 'pro_1',
      handleNormalized: 'tovis-studio',
      isPremium: false,
    })
    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_pro_1',
        type: NfcCardType.PRO_BOOKING,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
        professionalId: 'pro_1',
      }),
    )

    await expect(renderPage({ cardId: 'card_pro_1' })).rejects.toThrow(
      'REDIRECT:/professionals/pro_1?ti=tap_intent_1',
    )
  })

  it('redirects PRO_BOOKING to the unavailable page when the pro is not bookable', async () => {
    mocks.checkReadiness.mockResolvedValueOnce({
      ok: false,
      blockers: ['NO_ACTIVE_OFFERING'],
    })
    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_pro_unready',
        type: NfcCardType.PRO_BOOKING,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
        professionalId: 'pro_1',
      }),
    )

    await expect(renderPage({ cardId: 'card_pro_unready' })).rejects.toThrow(
      'REDIRECT:/nfc/invalid?reason=unavailable',
    )
    expect(mocks.tapIntentCreate).not.toHaveBeenCalled()
  })

  it('redirects PRO_BOOKING to unavailable when the professional profile is missing', async () => {
    mocks.professionalProfileFindUnique.mockResolvedValueOnce(null)
    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_pro_missing',
        type: NfcCardType.PRO_BOOKING,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
        professionalId: 'pro_missing',
      }),
    )

    await expect(renderPage({ cardId: 'card_pro_missing' })).rejects.toThrow(
      'REDIRECT:/nfc/invalid?reason=unavailable',
    )
    expect(mocks.tapIntentCreate).not.toHaveBeenCalled()
  })

  it('creates a SALON_WHITE_LABEL intent and redirects an anon user to salon signup', async () => {
    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_salon_1',
        type: NfcCardType.SALON_WHITE_LABEL,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
        tenantSlug: 'glow-house',
      }),
    )

    await expect(renderPage({ cardId: 'card_salon_1' })).rejects.toThrow(
      'REDIRECT:/signup?salon=glow-house&ti=tap_intent_1',
    )

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_salon_1',
        userId: null,
        intentType: 'SALON_WHITE_LABEL',
        payloadJson: { tenantSlug: 'glow-house' },
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: { id: true },
    })
  })

  it('applies a safe local next override as the post-auth destination', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(makeUser())
    mocks.consumeTapIntent.mockResolvedValueOnce({
      ok: true,
      nextUrl: '/client/bookings',
    })
    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_pro_1',
        type: NfcCardType.PRO_BOOKING,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
        professionalId: 'pro_1',
      }),
    )

    await expect(
      renderPage({ cardId: 'card_pro_1', searchParams: { next: '/client/bookings' } }),
    ).rejects.toThrow('REDIRECT:/client/bookings')

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_pro_1',
        userId: 'user_1',
        intentType: 'BOOK_PRO',
        payloadJson: { professionalId: 'pro_1', nextUrl: '/client/bookings' },
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: { id: true },
    })
  })

  it.each([
    ['external URL', 'https://evil.example'],
    ['protocol-relative URL', '//evil.example'],
    ['blank string', '   '],
  ])('ignores unsafe next override: %s', async (_label, next) => {
    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_pro_1',
        type: NfcCardType.PRO_BOOKING,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
        professionalId: 'pro_1',
      }),
    )

    await expect(
      renderPage({ cardId: 'card_pro_1', searchParams: { next } }),
    ).rejects.toThrow('REDIRECT:/p/tovis-studio?ti=tap_intent_1')

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_pro_1',
        userId: null,
        intentType: 'BOOK_PRO',
        payloadJson: { professionalId: 'pro_1', nextUrl: '/p/tovis-studio' },
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: { id: true },
    })
  })
})
