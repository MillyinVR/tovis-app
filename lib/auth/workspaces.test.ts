import { describe, expect, it } from 'vitest'

import {
  buildWorkspaceOptions,
  canActAs,
  listAvailableWorkspaces,
  WORKSPACE_HOME,
  workspaceCapabilityOf,
  type WorkspaceCapabilityUser,
} from './workspaces'

function user(
  overrides: Partial<WorkspaceCapabilityUser> = {},
): WorkspaceCapabilityUser {
  return {
    homeRole: 'CLIENT',
    clientProfile: { id: 'cp_1' },
    professionalProfile: null,
    hasAdminGrant: false,
    ...overrides,
  }
}

describe('canActAs', () => {
  it('allows ADMIN when the home role is ADMIN', () => {
    expect(canActAs(user({ homeRole: 'ADMIN' }), 'ADMIN')).toBe(true)
    expect(canActAs(user({ homeRole: 'PRO' }), 'ADMIN')).toBe(false)
    expect(canActAs(user({ homeRole: 'CLIENT' }), 'ADMIN')).toBe(false)
  })

  it('allows ADMIN for a non-admin home role that holds a super-admin grant', () => {
    // A pro (home role PRO) who is also a super admin can act as Admin without
    // giving up Pro as their home workspace.
    expect(canActAs(user({ homeRole: 'PRO', hasAdminGrant: true }), 'ADMIN')).toBe(
      true,
    )
    expect(
      canActAs(user({ homeRole: 'CLIENT', hasAdminGrant: true }), 'ADMIN'),
    ).toBe(true)
    // No grant → still denied.
    expect(canActAs(user({ homeRole: 'PRO', hasAdminGrant: false }), 'ADMIN')).toBe(
      false,
    )
  })

  it('allows PRO only with an APPROVED professional profile', () => {
    expect(
      canActAs(
        user({ professionalProfile: { verificationStatus: 'APPROVED' } }),
        'PRO',
      ),
    ).toBe(true)
    expect(
      canActAs(
        user({ professionalProfile: { verificationStatus: 'PENDING' } }),
        'PRO',
      ),
    ).toBe(false)
    expect(canActAs(user({ professionalProfile: null }), 'PRO')).toBe(false)
  })

  it('allows PRO for a home-PRO user whose licence is still PENDING', () => {
    // The population POST /api/v1/pro/upgrade creates: it flips User.role to
    // PRO immediately, so the person acts as PRO with a PENDING profile. They
    // are already inside /pro/* (that layout checks acting role + profile,
    // never APPROVED) and resolveActingRole grants the home role without
    // asking this function — so refusing here only hid the switcher.
    expect(
      canActAs(
        user({
          homeRole: 'PRO',
          professionalProfile: { verificationStatus: 'PENDING' },
        }),
        'PRO',
      ),
    ).toBe(true)
  })

  it('still refuses PRO to a home-PRO user with no profile at all', () => {
    // app/pro/layout.tsx bounces this user, so offering the workspace would
    // hand them a door that immediately shuts.
    expect(
      canActAs(user({ homeRole: 'PRO', professionalProfile: null }), 'PRO'),
    ).toBe(false)
  })

  it('does not let a home-CLIENT act as PRO on an unapproved profile', () => {
    // The rule the APPROVED check was written for is untouched: entering PRO
    // from a different home role still requires a licensed profile.
    expect(
      canActAs(
        user({
          homeRole: 'CLIENT',
          professionalProfile: { verificationStatus: 'PENDING' },
        }),
        'PRO',
      ),
    ).toBe(false)
    expect(
      canActAs(
        user({
          homeRole: 'ADMIN',
          professionalProfile: { verificationStatus: 'REJECTED' },
        }),
        'PRO',
      ),
    ).toBe(false)
  })

  it('gives an upgraded client a way back to their client account', () => {
    // The regression this pair exists to stop. Before the home-role rule both
    // of these were [] — no switcher in the pro shell and none in the client
    // shell — while app/client/(gated)/layout.tsx redirects any acting role
    // that is not CLIENT. The upgrade is irreversible, so that was a one-way
    // door out of their own bookings, boards and chart.
    const upgraded = user({
      homeRole: 'PRO',
      clientProfile: { id: 'cp_1' },
      professionalProfile: { verificationStatus: 'PENDING' },
    })

    expect(listAvailableWorkspaces(upgraded)).toEqual(['PRO', 'CLIENT'])
    expect(
      buildWorkspaceOptions(upgraded, 'PRO').map((o) => o.role),
    ).toEqual(['PRO', 'CLIENT'])
    expect(
      buildWorkspaceOptions(upgraded, 'CLIENT').map((o) => o.role),
    ).toEqual(['PRO', 'CLIENT'])
  })

  it('always allows CLIENT (profile is provisioned on switch)', () => {
    expect(canActAs(user({ clientProfile: null }), 'CLIENT')).toBe(true)
    expect(canActAs(user({ homeRole: 'ADMIN', clientProfile: null }), 'CLIENT')).toBe(
      true,
    )
  })
})

describe('listAvailableWorkspaces', () => {
  it('returns only CLIENT for a pure client (no switcher)', () => {
    expect(listAvailableWorkspaces(user({ homeRole: 'CLIENT' }))).toEqual([
      'CLIENT',
    ])
  })

  it('returns PRO + CLIENT for an approved pro', () => {
    expect(
      listAvailableWorkspaces(
        user({
          homeRole: 'PRO',
          professionalProfile: { verificationStatus: 'APPROVED' },
        }),
      ),
    ).toEqual(['PRO', 'CLIENT'])
  })

  it('returns ADMIN + CLIENT for an admin without a pro license', () => {
    expect(
      listAvailableWorkspaces(user({ homeRole: 'ADMIN', professionalProfile: null })),
    ).toEqual(['ADMIN', 'CLIENT'])
  })

  it('returns ADMIN + PRO + CLIENT for a licensed admin', () => {
    expect(
      listAvailableWorkspaces(
        user({
          homeRole: 'ADMIN',
          professionalProfile: { verificationStatus: 'APPROVED' },
        }),
      ),
    ).toEqual(['ADMIN', 'PRO', 'CLIENT'])
  })

  it('returns ADMIN + PRO + CLIENT for a pro who holds a super-admin grant', () => {
    // The founder case: home role PRO, licensed, plus a SUPER_ADMIN grant.
    expect(
      listAvailableWorkspaces(
        user({
          homeRole: 'PRO',
          professionalProfile: { verificationStatus: 'APPROVED' },
          hasAdminGrant: true,
        }),
      ),
    ).toEqual(['ADMIN', 'PRO', 'CLIENT'])
  })
})

describe('buildWorkspaceOptions', () => {
  it('is empty for a single-workspace user (hides the switcher)', () => {
    expect(buildWorkspaceOptions(user({ homeRole: 'CLIENT' }), 'CLIENT')).toEqual([])
  })

  it('marks the current acting role active and maps hrefs', () => {
    const options = buildWorkspaceOptions(
      user({
        homeRole: 'ADMIN',
        professionalProfile: { verificationStatus: 'APPROVED' },
      }),
      'CLIENT',
    )

    expect(options.map((o) => o.role)).toEqual(['ADMIN', 'PRO', 'CLIENT'])
    expect(options.find((o) => o.current)?.role).toBe('CLIENT')
    expect(options.filter((o) => o.current)).toHaveLength(1)

    for (const option of options) {
      expect(option.href).toBe(WORKSPACE_HOME[option.role])
    }
  })
})

describe('workspaceCapabilityOf', () => {
  it('maps a CurrentUser-shaped record, folding canAccessAdmin → hasAdminGrant', () => {
    expect(
      workspaceCapabilityOf({
        homeRole: 'PRO',
        clientProfile: { id: 'cp_1' },
        professionalProfile: { verificationStatus: 'APPROVED' },
        canAccessAdmin: true,
      }),
    ).toEqual({
      homeRole: 'PRO',
      clientProfile: { id: 'cp_1' },
      professionalProfile: { verificationStatus: 'APPROVED' },
      hasAdminGrant: true,
    })
  })
})
