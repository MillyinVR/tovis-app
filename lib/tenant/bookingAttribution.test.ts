import { describe, expect, it, vi } from 'vitest'

import { resolveBookingTenantAttribution } from './bookingAttribution'

function makeTx(args: {
  proHomeTenantId: string | null | undefined
  clientHomeTenantId: string | null | undefined
}) {
  return {
    professionalProfile: {
      findUnique: vi.fn().mockResolvedValue(
        args.proHomeTenantId === undefined
          ? null
          : { homeTenantId: args.proHomeTenantId },
      ),
    },
    clientProfile: {
      findUnique: vi.fn().mockResolvedValue(
        args.clientHomeTenantId === undefined
          ? null
          : { homeTenantId: args.clientHomeTenantId },
      ),
    },
  }
}

describe('resolveBookingTenantAttribution', () => {
  it('snapshots both tenants from the profiles', async () => {
    const tx = makeTx({
      proHomeTenantId: 'tenant_salon',
      clientHomeTenantId: 'tenant_root',
    })

    const attribution = await resolveBookingTenantAttribution(tx, {
      professionalId: 'pro_1',
      clientId: 'client_1',
    })

    expect(attribution).toEqual({
      proTenantId: 'tenant_salon',
      clientHomeTenantId: 'tenant_root',
    })
    expect(tx.professionalProfile.findUnique).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      select: { homeTenantId: true },
    })
    expect(tx.clientProfile.findUnique).toHaveBeenCalledWith({
      where: { id: 'client_1' },
      select: { homeTenantId: true },
    })
  })

  it('returns nulls for un-backfilled profiles (expand phase)', async () => {
    const tx = makeTx({ proHomeTenantId: null, clientHomeTenantId: null })

    await expect(
      resolveBookingTenantAttribution(tx, {
        professionalId: 'pro_1',
        clientId: 'client_1',
      }),
    ).resolves.toEqual({ proTenantId: null, clientHomeTenantId: null })
  })

  it('returns nulls when profiles are missing rather than failing the booking', async () => {
    const tx = makeTx({
      proHomeTenantId: undefined,
      clientHomeTenantId: undefined,
    })

    await expect(
      resolveBookingTenantAttribution(tx, {
        professionalId: 'pro_missing',
        clientId: 'client_missing',
      }),
    ).resolves.toEqual({ proTenantId: null, clientHomeTenantId: null })
  })
})
