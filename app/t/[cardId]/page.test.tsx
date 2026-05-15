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
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
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

import TapPage from './page'

function makeRedirectError(href: string): Error {
  return new Error(`REDIRECT:${href}`)
}

function makeCard(overrides?: {
  id?: string
  type?: NfcCardType
  isActive?: boolean
  claimedAt?: Date | null
  professionalId?: string | null
  salonSlug?: string | null
}) {
  return {
    id: overrides?.id ?? 'card_1',
    type: overrides?.type ?? NfcCardType.UNASSIGNED,
    isActive: overrides?.isActive ?? true,
    claimedAt:
      overrides && 'claimedAt' in overrides
        ? overrides.claimedAt
        : null,
    professionalId:
      overrides && 'professionalId' in overrides
        ? overrides.professionalId
        : null,
    salonSlug:
      overrides && 'salonSlug' in overrides ? overrides.salonSlug : null,
  }
}

function makeUser(overrides?: { id?: string }) {
  return {
    id: overrides?.id ?? 'user_1',
    role: 'CLIENT',
  }
}

async function renderPage(args?: {
  cardId?: string
  searchParams?: Record<string, string | undefined>
}) {
  const props: Parameters<typeof TapPage>[0] = {
    params: Promise.resolve({
      cardId: args?.cardId ?? 'card_1',
    }),
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
      throw makeRedirectError(href)
    })

    mocks.getCurrentUser.mockResolvedValue(null)

    mocks.nfcCardFindUnique.mockResolvedValue(makeCard())

    mocks.professionalProfileFindUnique.mockResolvedValue({
      id: 'pro_1',
      handleNormalized: 'tovis-studio',
      isPremium: true,
    })

    mocks.tapIntentCreate.mockResolvedValue({
      id: 'tap_intent_1',
    })
  })

  it('redirects to invalid page when card does not exist', async () => {
    mocks.nfcCardFindUnique.mockResolvedValueOnce(null)

    await expect(renderPage()).rejects.toThrow('REDIRECT:/nfc/invalid')

    expect(mocks.nfcCardFindUnique).toHaveBeenCalledWith({
      where: {
        id: 'card_1',
      },
      select: {
        id: true,
        type: true,
        isActive: true,
        claimedAt: true,
        professionalId: true,
        salonSlug: true,
      },
    })

    expect(mocks.tapIntentCreate).not.toHaveBeenCalled()
  })

  it('redirects to invalid page when card is inactive', async () => {
    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        isActive: false,
      }),
    )

    await expect(renderPage()).rejects.toThrow('REDIRECT:/nfc/invalid')

    expect(mocks.tapIntentCreate).not.toHaveBeenCalled()
  })

  it('creates CLAIM_CARD intent and redirects unauthenticated user to signup with tap intent', async () => {
    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_unclaimed_1',
        type: NfcCardType.UNASSIGNED,
        claimedAt: null,
      }),
    )

    await expect(
      renderPage({
        cardId: 'card_unclaimed_1',
      }),
    ).rejects.toThrow('REDIRECT:/signup?ti=tap_intent_1')

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_unclaimed_1',
        userId: null,
        intentType: 'CLAIM_CARD',
        payloadJson: {
          nextUrl: '/signup',
        },
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: {
        id: true,
      },
    })
  })

  it('creates CLAIM_CARD intent for claimed UNASSIGNED card because UNASSIGNED is treated as unclaimed', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(makeUser())

    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_unassigned_claimed_1',
        type: NfcCardType.UNASSIGNED,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
      }),
    )

    await expect(
      renderPage({
        cardId: 'card_unassigned_claimed_1',
      }),
    ).rejects.toThrow('REDIRECT:/signup?ti=tap_intent_1')

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_unassigned_claimed_1',
        userId: 'user_1',
        intentType: 'CLAIM_CARD',
        payloadJson: {
          nextUrl: '/signup',
        },
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: {
        id: true,
      },
    })
  })

  it('creates BOOK_PRO intent and redirects premium pro card to handle page with tap intent', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(makeUser())

    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_pro_1',
        type: NfcCardType.PRO_BOOKING,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
        professionalId: 'pro_1',
      }),
    )

    await expect(
      renderPage({
        cardId: 'card_pro_1',
      }),
    ).rejects.toThrow('REDIRECT:/p/tovis-studio?ti=tap_intent_1')

    expect(mocks.professionalProfileFindUnique).toHaveBeenCalledWith({
      where: {
        id: 'pro_1',
      },
      select: {
        id: true,
        handleNormalized: true,
        isPremium: true,
      },
    })

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_pro_1',
        userId: 'user_1',
        intentType: 'BOOK_PRO',
        payloadJson: {
          professionalId: 'pro_1',
          nextUrl: '/p/tovis-studio',
        },
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: {
        id: true,
      },
    })
  })

  it('creates BOOK_PRO intent and redirects non-premium pro card to professional page with tap intent', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(makeUser())

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

    await expect(
      renderPage({
        cardId: 'card_pro_1',
      }),
    ).rejects.toThrow('REDIRECT:/professionals/pro_1?ti=tap_intent_1')

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_pro_1',
        userId: 'user_1',
        intentType: 'BOOK_PRO',
        payloadJson: {
          professionalId: 'pro_1',
          nextUrl: '/professionals/pro_1',
        },
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: {
        id: true,
      },
    })
  })

  it('redirects BOOK_PRO card to invalid when professional profile does not exist', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(makeUser())

    mocks.professionalProfileFindUnique.mockResolvedValueOnce(null)

    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_pro_missing_1',
        type: NfcCardType.PRO_BOOKING,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
        professionalId: 'pro_missing',
      }),
    )

    await expect(
      renderPage({
        cardId: 'card_pro_missing_1',
      }),
    ).rejects.toThrow('REDIRECT:/nfc/invalid?ti=tap_intent_1')

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_pro_missing_1',
        userId: 'user_1',
        intentType: 'BOOK_PRO',
        payloadJson: {
          professionalId: 'pro_missing',
          nextUrl: '/nfc/invalid',
        },
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: {
        id: true,
      },
    })
  })

  it('creates SALON_WHITE_LABEL intent and redirects to salon signup with tap intent', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(makeUser())

    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_salon_1',
        type: NfcCardType.SALON_WHITE_LABEL,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
        salonSlug: 'glow-house',
      }),
    )

    await expect(
      renderPage({
        cardId: 'card_salon_1',
      }),
    ).rejects.toThrow('REDIRECT:/signup?salon=glow-house&ti=tap_intent_1')

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_salon_1',
        userId: 'user_1',
        intentType: 'SALON_WHITE_LABEL',
        payloadJson: {
          salonSlug: 'glow-house',
          nextUrl: '/signup?salon=glow-house',
        },
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: {
        id: true,
      },
    })
  })

  it('uses safe local next override instead of derived nextUrl', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(makeUser())

    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_pro_1',
        type: NfcCardType.PRO_BOOKING,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
        professionalId: 'pro_1',
      }),
    )

    await expect(
      renderPage({
        cardId: 'card_pro_1',
        searchParams: {
          next: '/client/bookings',
        },
      }),
    ).rejects.toThrow('REDIRECT:/client/bookings?ti=tap_intent_1')

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_pro_1',
        userId: 'user_1',
        intentType: 'BOOK_PRO',
        payloadJson: {
          professionalId: 'pro_1',
          nextUrl: '/client/bookings',
        },
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: {
        id: true,
      },
    })
  })

  it.each([
    ['external URL', 'https://evil.example'],
    ['protocol-relative URL', '//evil.example'],
    ['blank string', '   '],
  ])('ignores unsafe next override: %s', async (_label, next) => {
    mocks.getCurrentUser.mockResolvedValueOnce(makeUser())

    mocks.nfcCardFindUnique.mockResolvedValueOnce(
      makeCard({
        id: 'card_pro_1',
        type: NfcCardType.PRO_BOOKING,
        claimedAt: new Date('2026-04-10T12:00:00.000Z'),
        professionalId: 'pro_1',
      }),
    )

    await expect(
      renderPage({
        cardId: 'card_pro_1',
        searchParams: {
          next,
        },
      }),
    ).rejects.toThrow('REDIRECT:/p/tovis-studio?ti=tap_intent_1')

    expect(mocks.tapIntentCreate).toHaveBeenCalledWith({
      data: {
        cardId: 'card_pro_1',
        userId: 'user_1',
        intentType: 'BOOK_PRO',
        payloadJson: {
          professionalId: 'pro_1',
          nextUrl: '/p/tovis-studio',
        },
        expiresAt: new Date('2026-04-12T12:30:00.000Z'),
      },
      select: {
        id: true,
      },
    })
  })
})