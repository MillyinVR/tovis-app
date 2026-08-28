// lib/shortLink/shortLinkService.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    shortLink: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import {
  buildShortLinkUrl,
  getOrCreateShortLink,
  ShortLinkDestinationNotAllowedError,
} from './shortLinkService'

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  })
}

describe('getOrCreateShortLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mints a new code for a first-time (createdForType, createdForId)', async () => {
    mocks.prisma.shortLink.findUnique.mockResolvedValue(null)
    mocks.prisma.shortLink.create.mockResolvedValue({ code: 'Ab3xK9pQ' })

    const result = await getOrCreateShortLink({
      destinationPath: '/client/deposit/rawtoken123',
      createdForType: 'notification_dispatch_href',
      createdForId: 'dispatch_1',
    })

    expect(result).toEqual({ code: 'Ab3xK9pQ' })
    expect(mocks.prisma.shortLink.create).toHaveBeenCalledTimes(1)
    const call = mocks.prisma.shortLink.create.mock.calls[0]
    if (!call) throw new Error('shortLink.create was not called')
    const data = call[0].data
    expect(data.destinationPath).toBe('/client/deposit/rawtoken123')
    expect(data.createdForType).toBe('notification_dispatch_href')
    expect(data.createdForId).toBe('dispatch_1')
    expect(data.expiresAt).toBeNull()
    expect(data.code).toMatch(/^[0-9A-Za-z]{8}$/)
  })

  it('reuses the existing code for a repeat (createdForType, createdForId) without minting', async () => {
    mocks.prisma.shortLink.findUnique.mockResolvedValue({ code: 'existing1' })

    const result = await getOrCreateShortLink({
      destinationPath: '/client/deposit/rawtoken123',
      createdForType: 'notification_dispatch_href',
      createdForId: 'dispatch_1',
    })

    expect(result).toEqual({ code: 'existing1' })
    expect(mocks.prisma.shortLink.create).not.toHaveBeenCalled()
  })

  it('passes expiresAt through when supplied', async () => {
    mocks.prisma.shortLink.findUnique.mockResolvedValue(null)
    mocks.prisma.shortLink.create.mockResolvedValue({ code: 'Ab3xK9pQ' })

    const expiresAt = new Date('2026-08-20T00:00:00.000Z')
    await getOrCreateShortLink({
      destinationPath: '/client/deposit/rawtoken123',
      createdForType: 'notification_dispatch_href',
      createdForId: 'dispatch_1',
      expiresAt,
    })

    const call = mocks.prisma.shortLink.create.mock.calls[0]
    if (!call) throw new Error('shortLink.create was not called')
    expect(call[0].data.expiresAt).toBe(expiresAt)
  })

  // ⚠️ The production regression. The booking-finalize pro notification
  // (app/api/v1/bookings/finalize createFinalizeProNotification) dispatches
  // `/pro/bookings/{id}`, and BOOKING_REQUEST_CREATED is SMS-capable for a pro
  // (PRO_ALL_CHANNELS), so the drain mints a short link for it on every send.
  // The prefix was missing from the allowlist, so this threw instead —
  // recurring on every booking finalize, not a one-off.
  it('mints a short link for the pro booking href a booking-finalize notification carries', async () => {
    mocks.prisma.shortLink.findUnique.mockResolvedValue(null)
    mocks.prisma.shortLink.create.mockResolvedValue({ code: 'ProBk9pQ1' })

    const result = await getOrCreateShortLink({
      destinationPath: '/pro/bookings/cmtb32x6n0007l804guk94sgl',
      createdForType: 'notification_dispatch_href',
      createdForId: 'cmtb32xfp000cl804qt7aqsp6',
    })

    expect(result).toEqual({ code: 'ProBk9pQ1' })
    const call = mocks.prisma.shortLink.create.mock.calls[0]
    if (!call) throw new Error('shortLink.create was not called')
    expect(call[0].data.destinationPath).toBe(
      '/pro/bookings/cmtb32x6n0007l804guk94sgl',
    )
  })

  it('throws ShortLinkDestinationNotAllowedError for a non-allowlisted path', async () => {
    mocks.prisma.shortLink.findUnique.mockResolvedValue(null)

    await expect(
      getOrCreateShortLink({
        destinationPath: '/pro/dashboard',
        createdForType: 'notification_dispatch_href',
        createdForId: 'dispatch_1',
      }),
    ).rejects.toBeInstanceOf(ShortLinkDestinationNotAllowedError)

    expect(mocks.prisma.shortLink.create).not.toHaveBeenCalled()
  })

  it('retries with a fresh code on a code collision', async () => {
    mocks.prisma.shortLink.findUnique
      .mockResolvedValueOnce(null) // initial createdFor lookup: no existing row
      .mockResolvedValueOnce(null) // race re-check after the first create fails: still no row
    mocks.prisma.shortLink.create
      .mockRejectedValueOnce(p2002())
      .mockResolvedValueOnce({ code: 'SecondTry' })

    const result = await getOrCreateShortLink({
      destinationPath: '/client/deposit/rawtoken123',
      createdForType: 'notification_dispatch_href',
      createdForId: 'dispatch_1',
    })

    expect(result).toEqual({ code: 'SecondTry' })
    expect(mocks.prisma.shortLink.create).toHaveBeenCalledTimes(2)
  })

  it('returns the winning row when a concurrent caller wins the createdFor race', async () => {
    mocks.prisma.shortLink.findUnique
      .mockResolvedValueOnce(null) // initial lookup: nothing yet
      .mockResolvedValueOnce({ code: 'WonTheRace' }) // re-check after P2002: someone else created it
    mocks.prisma.shortLink.create.mockRejectedValueOnce(p2002())

    const result = await getOrCreateShortLink({
      destinationPath: '/client/deposit/rawtoken123',
      createdForType: 'notification_dispatch_href',
      createdForId: 'dispatch_1',
    })

    expect(result).toEqual({ code: 'WonTheRace' })
    expect(mocks.prisma.shortLink.create).toHaveBeenCalledTimes(1)
  })

  it('rethrows a non-P2002 create error', async () => {
    mocks.prisma.shortLink.findUnique.mockResolvedValue(null)
    const boom = new Error('connection reset')
    mocks.prisma.shortLink.create.mockRejectedValue(boom)

    await expect(
      getOrCreateShortLink({
        destinationPath: '/client/deposit/rawtoken123',
        createdForType: 'notification_dispatch_href',
        createdForId: 'dispatch_1',
      }),
    ).rejects.toBe(boom)
  })
})

describe('buildShortLinkUrl', () => {
  const originalRootDomain = process.env.APP_ROOT_DOMAIN

  afterEach(() => {
    if (originalRootDomain === undefined) {
      delete process.env.APP_ROOT_DOMAIN
    } else {
      process.env.APP_ROOT_DOMAIN = originalRootDomain
    }
  })

  it('builds an absolute https URL on the vanity root domain', () => {
    process.env.APP_ROOT_DOMAIN = 'tovis.me'
    expect(buildShortLinkUrl('Ab3xK9pQ')).toBe('https://tovis.me/s/Ab3xK9pQ')
  })

  it('falls back to tovis.me when APP_ROOT_DOMAIN is unset', () => {
    delete process.env.APP_ROOT_DOMAIN
    expect(buildShortLinkUrl('Ab3xK9pQ')).toBe('https://tovis.me/s/Ab3xK9pQ')
  })
})
