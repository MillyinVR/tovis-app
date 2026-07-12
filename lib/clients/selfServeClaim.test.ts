// lib/clients/selfServeClaim.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactMethod } from '@prisma/client'

import {
  clearContactLookupHmacKeyringCacheForTests,
  CONTACT_LOOKUP_HMAC_KEY_VERSION,
  emailLookupHashV2,
  phoneLookupHashV2,
} from '@/lib/security/crypto/hashLookup'

const TEST_EMAIL = 'tori@example.com'
const TEST_PHONE = '+16195551234'
const TEST_HMAC_KEY = Buffer.alloc(32, 7).toString('base64')
const ORIGINAL_ENV = { ...process.env }

const mocks = vi.hoisted(() => ({
  prisma: {
    clientProfile: { findMany: vi.fn() },
    booking: { findFirst: vi.fn() },
  },
  issueClaimLinkForBooking: vi.fn(),
  issueClaimLinkForClient: vi.fn(),
  createClientClaimInviteDelivery: vi.fn(),
  kickNotificationDrain: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('./clientClaimLinks', () => ({
  issueClaimLinkForBooking: mocks.issueClaimLinkForBooking,
  issueClaimLinkForClient: mocks.issueClaimLinkForClient,
}))
vi.mock('@/lib/clientActions/createClientClaimInviteDelivery', () => ({
  createClientClaimInviteDelivery: mocks.createClientClaimInviteDelivery,
}))
vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))

import {
  findSelfServeClaimableProfile,
  sendSelfServeClaimLink,
} from './selfServeClaim'

function emailHashRow() {
  const h = emailLookupHashV2(TEST_EMAIL)
  return { emailHashV2: h?.hash ?? null, emailHashKeyVersion: h?.keyVersion ?? null }
}

function phoneHashRow() {
  const h = phoneLookupHashV2(TEST_PHONE)
  return { phoneHashV2: h?.hash ?? null, phoneHashKeyVersion: h?.keyVersion ?? null }
}

describe('selfServeClaim', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    process.env.PII_LOOKUP_HMAC_KEYS_JSON = JSON.stringify({
      [CONTACT_LOOKUP_HMAC_KEY_VERSION]: TEST_HMAC_KEY,
    })
    clearContactLookupHmacKeyringCacheForTests()
    vi.clearAllMocks()
    mocks.prisma.booking.findFirst.mockResolvedValue({ id: 'booking_1' })
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    clearContactLookupHmacKeyringCacheForTests()
  })

  describe('findSelfServeClaimableProfile', () => {
    it('returns null when no contact is provided', async () => {
      const result = await findSelfServeClaimableProfile({
        email: null,
        phone: null,
      })

      expect(result).toBeNull()
      expect(mocks.prisma.clientProfile.findMany).not.toHaveBeenCalled()
    })

    it('returns null when no unclaimed profile matches', async () => {
      mocks.prisma.clientProfile.findMany.mockResolvedValueOnce([])

      const result = await findSelfServeClaimableProfile({
        email: TEST_EMAIL,
        phone: null,
      })

      expect(result).toBeNull()
      expect(mocks.prisma.booking.findFirst).not.toHaveBeenCalled()
    })

    it('returns null on an ambiguous multi-profile match', async () => {
      mocks.prisma.clientProfile.findMany.mockResolvedValueOnce([
        { id: 'client_1', ...emailHashRow(), phoneHashV2: null, phoneHashKeyVersion: null },
        { id: 'client_2', emailHashV2: null, emailHashKeyVersion: null, ...phoneHashRow() },
      ])

      const result = await findSelfServeClaimableProfile({
        email: TEST_EMAIL,
        phone: TEST_PHONE,
      })

      expect(result).toBeNull()
    })

    it('returns a booking-less claimable profile when the match has no booking', async () => {
      mocks.prisma.clientProfile.findMany.mockResolvedValueOnce([
        { id: 'client_1', ...emailHashRow(), phoneHashV2: null, phoneHashKeyVersion: null },
      ])
      mocks.prisma.booking.findFirst.mockResolvedValueOnce(null)

      const result = await findSelfServeClaimableProfile({
        email: TEST_EMAIL,
        phone: null,
      })

      expect(result).toEqual({
        clientId: 'client_1',
        bookingId: null,
        maskedDestination: 't***@example.com',
      })
    })

    it('returns the claimable profile with a masked email when the email matches', async () => {
      mocks.prisma.clientProfile.findMany.mockResolvedValueOnce([
        { id: 'client_1', ...emailHashRow(), phoneHashV2: null, phoneHashKeyVersion: null },
      ])

      const result = await findSelfServeClaimableProfile({
        email: TEST_EMAIL,
        phone: '+15550001111',
      })

      expect(result).toEqual({
        clientId: 'client_1',
        bookingId: 'booking_1',
        maskedDestination: 't***@example.com',
      })
    })

    it('masks the phone when only the phone matches', async () => {
      mocks.prisma.clientProfile.findMany.mockResolvedValueOnce([
        { id: 'client_1', emailHashV2: null, emailHashKeyVersion: null, ...phoneHashRow() },
      ])

      const result = await findSelfServeClaimableProfile({
        email: 'someone-else@example.com',
        phone: TEST_PHONE,
      })

      expect(result?.clientId).toBe('client_1')
      expect(result?.maskedDestination).toContain('1234')
      expect(result?.maskedDestination).not.toContain('6195')
    })
  })

  describe('sendSelfServeClaimLink', () => {
    const tenantContext = {
      tenantId: 'tenant_root',
      slug: 'tovis-root',
      isRoot: true,
    }

    it('mints, delivers to the on-file contact, and kicks the drain', async () => {
      mocks.issueClaimLinkForBooking.mockResolvedValueOnce({
        kind: 'ok',
        rawToken: 'rawtok_1',
        invite: {
          id: 'invite_1',
          professionalId: 'pro_1',
          clientId: 'client_1',
          bookingId: 'booking_1',
          invitedName: 'Tori Morales',
          invitedEmail: TEST_EMAIL,
          invitedPhone: TEST_PHONE,
          preferredContactMethod: ContactMethod.EMAIL,
        },
      })

      const result = await sendSelfServeClaimLink({
        clientId: 'client_1',
        bookingId: 'booking_1',
        tenantContext: tenantContext as never,
      })

      expect(result).toEqual({ sent: true })
      expect(mocks.issueClaimLinkForBooking).toHaveBeenCalledWith({
        bookingId: 'booking_1',
      })
      expect(mocks.issueClaimLinkForClient).not.toHaveBeenCalled()
      expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          professionalId: 'pro_1',
          clientId: 'client_1',
          bookingId: 'booking_1',
          inviteId: 'invite_1',
          rawToken: 'rawtok_1',
          invitedEmail: TEST_EMAIL,
          invitedPhone: TEST_PHONE,
          recipientUserId: null,
        }),
      )
      expect(mocks.kickNotificationDrain).toHaveBeenCalledTimes(1)
    })

    it('mints a booking-less, pro-less link when there is no booking', async () => {
      mocks.issueClaimLinkForClient.mockResolvedValueOnce({
        kind: 'ok',
        rawToken: 'rawtok_2',
        invite: {
          id: 'invite_2',
          professionalId: null,
          clientId: 'client_1',
          bookingId: null,
          invitedName: 'Tori Morales',
          invitedEmail: TEST_EMAIL,
          invitedPhone: null,
          preferredContactMethod: ContactMethod.EMAIL,
        },
      })

      const result = await sendSelfServeClaimLink({
        clientId: 'client_1',
        bookingId: null,
        tenantContext: tenantContext as never,
      })

      expect(result).toEqual({ sent: true })
      expect(mocks.issueClaimLinkForClient).toHaveBeenCalledWith({
        clientId: 'client_1',
        professionalId: null,
      })
      expect(mocks.issueClaimLinkForBooking).not.toHaveBeenCalled()
      expect(mocks.createClientClaimInviteDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          professionalId: null,
          clientId: 'client_1',
          bookingId: null,
          inviteId: 'invite_2',
          rawToken: 'rawtok_2',
        }),
      )
      expect(mocks.kickNotificationDrain).toHaveBeenCalledTimes(1)
    })

    it('does not deliver when the invite can no longer be issued', async () => {
      mocks.issueClaimLinkForBooking.mockResolvedValueOnce({
        kind: 'already_claimed',
      })

      const result = await sendSelfServeClaimLink({
        clientId: 'client_1',
        bookingId: 'booking_1',
        tenantContext: tenantContext as never,
      })

      expect(result).toEqual({ sent: false })
      expect(mocks.createClientClaimInviteDelivery).not.toHaveBeenCalled()
      expect(mocks.kickNotificationDrain).not.toHaveBeenCalled()
    })
  })
})
