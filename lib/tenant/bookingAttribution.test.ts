import { describe, expect, it, vi } from 'vitest'

import {
  resolveBookingTenantAttribution,
  resolveProTenantId,
} from './bookingAttribution'

function makeTx(args: {
  proHomeTenantId: string | undefined
  clientHomeTenantId: string | undefined
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

  it('throws when the professional profile is missing (contract-phase integrity)', async () => {
    const tx = makeTx({
      proHomeTenantId: undefined,
      clientHomeTenantId: 'tenant_root',
    })

    await expect(
      resolveBookingTenantAttribution(tx, {
        professionalId: 'pro_missing',
        clientId: 'client_1',
      }),
    ).rejects.toThrow(/professional pro_missing not found/)
  })

  it('throws when the client profile is missing (contract-phase integrity)', async () => {
    const tx = makeTx({
      proHomeTenantId: 'tenant_salon',
      clientHomeTenantId: undefined,
    })

    await expect(
      resolveBookingTenantAttribution(tx, {
        professionalId: 'pro_1',
        clientId: 'client_missing',
      }),
    ).rejects.toThrow(/client client_missing not found/)
  })
})

describe('resolveProTenantId', () => {
  it('returns the professional home tenant', async () => {
    const tx = makeTx({
      proHomeTenantId: 'tenant_salon',
      clientHomeTenantId: 'tenant_root',
    })

    await expect(resolveProTenantId(tx, 'pro_1')).resolves.toBe('tenant_salon')
    expect(tx.professionalProfile.findUnique).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      select: { homeTenantId: true },
    })
  })

  it('throws when the professional profile is missing (contract-phase integrity)', async () => {
    const tx = makeTx({
      proHomeTenantId: undefined,
      clientHomeTenantId: 'tenant_root',
    })

    await expect(resolveProTenantId(tx, 'pro_missing')).rejects.toThrow(
      'resolveProTenantId: professional pro_missing not found',
    )
  })
})
