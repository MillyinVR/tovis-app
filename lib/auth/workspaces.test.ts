import { describe, expect, it } from 'vitest'

import {
  buildWorkspaceOptions,
  canActAs,
  listAvailableWorkspaces,
  WORKSPACE_HOME,
  type WorkspaceCapabilityUser,
} from './workspaces'

function user(
  overrides: Partial<WorkspaceCapabilityUser> = {},
): WorkspaceCapabilityUser {
  return {
    homeRole: 'CLIENT',
    clientProfile: { id: 'cp_1' },
    professionalProfile: null,
    ...overrides,
  }
}

describe('canActAs', () => {
  it('allows ADMIN only when the home role is ADMIN', () => {
    expect(canActAs(user({ homeRole: 'ADMIN' }), 'ADMIN')).toBe(true)
    expect(canActAs(user({ homeRole: 'PRO' }), 'ADMIN')).toBe(false)
    expect(canActAs(user({ homeRole: 'CLIENT' }), 'ADMIN')).toBe(false)
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
