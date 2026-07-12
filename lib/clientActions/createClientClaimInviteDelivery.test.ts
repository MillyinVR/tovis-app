// lib/clientActions/createClientClaimInviteDelivery.test.ts
//
// Exercises the real copy builders (title/body) through
// createClientClaimInviteDelivery for the three shapes: booking-bearing,
// booking-less pro-facing, and booking-less pro-less (cold self-serve). The
// orchestration + enqueue + brand collaborators are mocked so we assert only the
// copy the client actually receives.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactMethod } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    booking: { findUnique: vi.fn() },
    professionalProfile: { findUnique: vi.fn() },
  },
  orchestrateClientActionDelivery: vi.fn(),
  enqueueClientActionDispatch: vi.fn(),
  buildClientActionLinkForType: vi.fn(),
  getBrandForTenantContext: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('./orchestrateClientActionDelivery', () => ({
  orchestrateClientActionDelivery: mocks.orchestrateClientActionDelivery,
}))
vi.mock('./enqueueClientActionDispatch', () => ({
  enqueueClientActionDispatch: mocks.enqueueClientActionDispatch,
}))
vi.mock('./linkBuilders', () => ({
  buildClientActionLinkForType: mocks.buildClientActionLinkForType,
}))
vi.mock('@/lib/brand/forTenant', () => ({
  getBrandForTenantContext: mocks.getBrandForTenantContext,
}))

import { createClientClaimInviteDelivery } from './createClientClaimInviteDelivery'

const tenantContext = { tenantId: 't', slug: 's', isRoot: true } as never

function enqueuedCopy(): { title: string; body: string } {
  const call = mocks.enqueueClientActionDispatch.mock.calls[0]
  if (!call) throw new Error('enqueueClientActionDispatch was not called')
  return { title: call[0].title, body: call[0].body }
}

const baseArgs = {
  clientId: 'client_1',
  inviteId: 'invite_1',
  rawToken: 'rawtok',
  tenantContext,
  invitedEmail: 'tori@example.com',
  invitedPhone: null,
  preferredContactMethod: ContactMethod.EMAIL,
  recipientUserId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.orchestrateClientActionDelivery.mockReturnValue({
    ok: true,
    plan: { recipient: {} },
  })
  mocks.enqueueClientActionDispatch.mockResolvedValue({ id: 'dispatch_1' })
  mocks.buildClientActionLinkForType.mockReturnValue({ href: '/claim/rawtok' })
  mocks.getBrandForTenantContext.mockReturnValue({ displayName: 'Tovis' })
})

describe('createClientClaimInviteDelivery copy', () => {
  it('booking-bearing invite uses "you\'re booked" copy from the booking', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue({
      scheduledFor: null,
      locationTimeZone: 'America/Los_Angeles',
      service: { name: 'Balayage' },
      professional: {
        businessName: 'Glow Studio',
        firstName: null,
        lastName: null,
        handle: null,
        nameDisplay: null,
        timeZone: 'America/Los_Angeles',
      },
    })

    await createClientClaimInviteDelivery({
      ...baseArgs,
      professionalId: 'pro_1',
      bookingId: 'booking_1',
      invitedName: 'Tori',
    })

    const { title, body } = enqueuedCopy()
    expect(title).toBe("You're booked with Glow Studio")
    expect(body).toContain('Balayage with Glow Studio')
  })

  it('booking-less pro-facing invite says the pro added you (no booking read)', async () => {
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue({
      businessName: 'Glow Studio',
      firstName: null,
      lastName: null,
      handle: null,
      nameDisplay: null,
    })

    await createClientClaimInviteDelivery({
      ...baseArgs,
      professionalId: 'pro_1',
      bookingId: null,
      invitedName: 'Tori',
    })

    const { title, body } = enqueuedCopy()
    expect(mocks.prisma.booking.findUnique).not.toHaveBeenCalled()
    expect(title).toBe('Glow Studio added you on Tovis')
    expect(body).toContain('Glow Studio added you as a client on Tovis')
  })

  it('booking-less pro-less invite uses brand-level claim copy (no pro read)', async () => {
    await createClientClaimInviteDelivery({
      ...baseArgs,
      professionalId: null,
      bookingId: null,
      invitedName: null,
    })

    const { title, body } = enqueuedCopy()
    expect(mocks.prisma.booking.findUnique).not.toHaveBeenCalled()
    expect(mocks.prisma.professionalProfile.findUnique).not.toHaveBeenCalled()
    expect(title).toBe('Claim your Tovis account')
    expect(body).toContain('We found existing history for your contact on Tovis')
  })
})
