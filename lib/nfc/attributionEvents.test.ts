// lib/nfc/attributionEvents.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    attributionEvent: { create: mocks.create },
  },
}))

import { prisma } from '@/lib/prisma'

import {
  NFC_ATTRIBUTION_EVENT,
  recordNfcCardTappedEvent,
} from './attributionEvents'

describe('recordNfcCardTappedEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes a CARD_TAPPED attribution event', async () => {
    mocks.create.mockResolvedValue({ id: 'evt_1' })

    await recordNfcCardTappedEvent({
      db: prisma,
      cardId: 'card_1',
      actorUserId: 'user_1',
      meta: { tapIntentId: 'ti_1', intentType: 'CLAIM_CARD' },
    })

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        eventType: NFC_ATTRIBUTION_EVENT.CARD_TAPPED,
        cardId: 'card_1',
        actorUserId: 'user_1',
        metaJson: { tapIntentId: 'ti_1', intentType: 'CLAIM_CARD' },
      },
    })
  })

  it('swallows write errors so a failed analytics write never breaks a tap', async () => {
    mocks.create.mockRejectedValue(new Error('db down'))

    await expect(
      recordNfcCardTappedEvent({
        db: prisma,
        cardId: 'card_1',
        actorUserId: null,
        meta: {},
      }),
    ).resolves.toBeUndefined()
  })
})
