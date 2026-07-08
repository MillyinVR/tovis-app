import { describe, expect, it } from 'vitest'

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
})
