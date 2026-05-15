// app/c/[code]/page.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  normalizeShortCode: vi.fn(),
  nfcCardFindUnique: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

vi.mock('@/lib/nfcShortCode', () => ({
  normalizeShortCode: mocks.normalizeShortCode,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    nfcCard: {
      findUnique: mocks.nfcCardFindUnique,
    },
  },
}))

import CodeRedirectPage from './page'

function makeRedirectError(href: string): Error {
  return new Error(`REDIRECT:${href}`)
}

async function renderPage(code = 'abc123') {
  return CodeRedirectPage({
    params: Promise.resolve({
      code,
    }),
  })
}

describe('app/c/[code]/page.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.redirect.mockImplementation((href: string) => {
      throw makeRedirectError(href)
    })

    mocks.normalizeShortCode.mockImplementation((value: string) => {
      const normalized = value.trim().toUpperCase()
      return normalized.length > 0 ? normalized : null
    })

    mocks.nfcCardFindUnique.mockResolvedValue({
      id: 'card_1',
      isActive: true,
    })
  })

  it('redirects to invalid page when short code normalizes to null', async () => {
    mocks.normalizeShortCode.mockReturnValueOnce(null)

    await expect(renderPage('   ')).rejects.toThrow('REDIRECT:/nfc/invalid')

    expect(mocks.normalizeShortCode).toHaveBeenCalledWith('   ')
    expect(mocks.nfcCardFindUnique).not.toHaveBeenCalled()
  })

  it('loads card by normalized short code', async () => {
    await expect(renderPage(' abc123 ')).rejects.toThrow(
      'REDIRECT:/t/card_1',
    )

    expect(mocks.normalizeShortCode).toHaveBeenCalledWith(' abc123 ')
    expect(mocks.nfcCardFindUnique).toHaveBeenCalledWith({
      where: {
        shortCode: 'ABC123',
      },
      select: {
        id: true,
        isActive: true,
      },
    })
  })

  it('redirects to invalid page when no card matches short code', async () => {
    mocks.nfcCardFindUnique.mockResolvedValueOnce(null)

    await expect(renderPage('abc123')).rejects.toThrow(
      'REDIRECT:/nfc/invalid',
    )

    expect(mocks.nfcCardFindUnique).toHaveBeenCalledWith({
      where: {
        shortCode: 'ABC123',
      },
      select: {
        id: true,
        isActive: true,
      },
    })
  })

  it('redirects to invalid page when card is inactive', async () => {
    mocks.nfcCardFindUnique.mockResolvedValueOnce({
      id: 'card_1',
      isActive: false,
    })

    await expect(renderPage('abc123')).rejects.toThrow(
      'REDIRECT:/nfc/invalid',
    )
  })

  it('redirects active card to tap route', async () => {
    mocks.nfcCardFindUnique.mockResolvedValueOnce({
      id: 'card_active_1',
      isActive: true,
    })

    await expect(renderPage('abc123')).rejects.toThrow(
      'REDIRECT:/t/card_active_1',
    )
  })
})