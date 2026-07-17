import { describe, expect, it } from 'vitest'
import { ProNameDisplay } from '@prisma/client'

import { formatPersonName, resolveThreadCounterparty } from './counterparty'

describe('formatPersonName', () => {
  it('joins first + last, trimming blanks', () => {
    expect(formatPersonName('Ada', 'Lovelace')).toBe('Ada Lovelace')
    expect(formatPersonName('Ada', null)).toBe('Ada')
    expect(formatPersonName(null, 'Lovelace')).toBe('Lovelace')
    expect(formatPersonName('  ', undefined)).toBe('')
  })
})

describe('resolveThreadCounterparty', () => {
  const client = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    avatarUrl: 'client.png',
  }
  const professional = {
    businessName: 'Glow Studio',
    firstName: 'Grace',
    lastName: 'Hopper',
    avatarUrl: 'pro.png',
  }

  it('shows the CLIENT to a pro viewer', () => {
    expect(
      resolveThreadCounterparty({ viewerIsThreadPro: true, client, professional }),
    ).toEqual({ title: 'Ada Lovelace', avatarUrl: 'client.png' })
  })

  it('shows the PRO (business name) to a client viewer', () => {
    expect(
      resolveThreadCounterparty({ viewerIsThreadPro: false, client, professional }),
    ).toEqual({ title: 'Glow Studio', avatarUrl: 'pro.png' })
  })

  it('falls back to "Client" / "Professional" when names are missing', () => {
    expect(
      resolveThreadCounterparty({
        viewerIsThreadPro: true,
        client: { firstName: null, lastName: null, avatarUrl: null },
        professional: null,
      }),
    ).toEqual({ title: 'Client', avatarUrl: null })

    expect(
      resolveThreadCounterparty({
        viewerIsThreadPro: false,
        client: null,
        professional: { businessName: null, firstName: null, lastName: null, avatarUrl: null },
      }),
    ).toEqual({ title: 'Professional', avatarUrl: null })
  })

  describe('honors the pro nameDisplay toggle for a client viewer', () => {
    const toggling = {
      businessName: 'Glow Studio',
      firstName: 'Grace',
      lastName: 'Hopper',
      handle: 'grace',
      avatarUrl: 'pro.png',
    }

    it('REAL_NAME → the real name', () => {
      expect(
        resolveThreadCounterparty({
          viewerIsThreadPro: false,
          client,
          professional: { ...toggling, nameDisplay: ProNameDisplay.REAL_NAME },
        }).title,
      ).toBe('Grace Hopper')
    })

    it('HANDLE → the @handle', () => {
      expect(
        resolveThreadCounterparty({
          viewerIsThreadPro: false,
          client,
          professional: { ...toggling, nameDisplay: ProNameDisplay.HANDLE },
        }).title,
      ).toBe('@grace')
    })

    it('BUSINESS_NAME → the business name', () => {
      expect(
        resolveThreadCounterparty({
          viewerIsThreadPro: false,
          client,
          professional: { ...toggling, nameDisplay: ProNameDisplay.BUSINESS_NAME },
        }).title,
      ).toBe('Glow Studio')
    })

    it('BUSINESS_NAME with no business name degrades to the real name, NEVER the handle', () => {
      expect(
        resolveThreadCounterparty({
          viewerIsThreadPro: false,
          client,
          professional: {
            businessName: null,
            firstName: 'Grace',
            lastName: 'Hopper',
            handle: 'grace',
            nameDisplay: ProNameDisplay.BUSINESS_NAME,
            avatarUrl: null,
          },
        }).title,
      ).toBe('Grace Hopper')
    })

    it('BUSINESS_NAME with neither business nor real name returns the fallback, NEVER the handle', () => {
      expect(
        resolveThreadCounterparty({
          viewerIsThreadPro: false,
          client,
          professional: {
            businessName: null,
            firstName: null,
            lastName: null,
            handle: 'grace',
            nameDisplay: ProNameDisplay.BUSINESS_NAME,
            avatarUrl: null,
          },
        }).title,
      ).toBe('Professional')
    })
  })
})
