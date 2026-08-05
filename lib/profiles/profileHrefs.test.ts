// lib/profiles/profileHrefs.test.ts
//
// THE rule for where a client's name/avatar goes on a pro-facing surface. Every
// pro surface routes through this, so the two directions are covered here once
// rather than re-asserted per screen:
//
//   PUBLIC client  → a real link
//   PRIVATE client → null, so the name renders with NO href in the DOM
//
// The private direction is the load-bearing one. A client who never opted into a
// public profile has no public page BY DESIGN (W-series privacy), and a link to
// `/u/<their handle>` would 404 on arrival — or, worse, confirm a handle they
// reserved but never published.
import { describe, expect, it } from 'vitest'

import {
  clientIdentityHref,
  clientIdentityHrefFromDto,
  clientLinkTarget,
  clientPublicHandle,
  clientPublicProfileHref,
  proClientChartHref,
  professionalProfileHref,
  resolveClientProfileHref,
  EMPTY_CLIENT_LINK_VIEWER,
} from './profileHrefs'
import { proPublicProfilePath } from '@/lib/routes'

const PUBLIC = { id: 'cl_1', handle: 'ada', isPublicProfile: true }
const PRIVATE_WITH_HANDLE = { id: 'cl_1', handle: 'ada', isPublicProfile: false }
const PUBLIC_NO_HANDLE = { id: 'cl_1', handle: null, isPublicProfile: true }

describe('clientPublicHandle', () => {
  it('returns the handle only when the client opted IN', () => {
    expect(clientPublicHandle(PUBLIC)).toBe('ada')
  })

  it('is null for a handle reserved but not published', () => {
    expect(clientPublicHandle(PRIVATE_WITH_HANDLE)).toBeNull()
  })

  it('is null when opted in but no handle was ever claimed', () => {
    expect(clientPublicHandle(PUBLIC_NO_HANDLE)).toBeNull()
  })

  it('treats a whitespace-only handle as no handle', () => {
    expect(clientPublicHandle({ handle: '   ', isPublicProfile: true })).toBeNull()
  })
})

describe('clientPublicProfileHref', () => {
  it('builds /u/[handle] for a public client', () => {
    expect(clientPublicProfileHref(PUBLIC)).toBe('/u/ada')
  })

  it('encodes the handle', () => {
    expect(
      clientPublicProfileHref({ handle: 'a b/c', isPublicProfile: true }),
    ).toBe('/u/a%20b%2Fc')
  })

  it('is null for every non-public shape', () => {
    expect(clientPublicProfileHref(PRIVATE_WITH_HANDLE)).toBeNull()
    expect(clientPublicProfileHref(PUBLIC_NO_HANDLE)).toBeNull()
  })
})

describe('clientIdentityHref — chart beats public, null beats a dead link', () => {
  it('prefers the chart when the pro may open it', () => {
    expect(clientIdentityHref(clientLinkTarget(PUBLIC), true)).toBe(
      '/pro/clients/cl_1',
    )
  })

  // 🔴 The bug this whole change exists for: chart closed + public client used
  // to mean dead text on every pro surface.
  it('falls back to the public profile when the chart is closed', () => {
    expect(clientIdentityHref(clientLinkTarget(PUBLIC), false)).toBe('/u/ada')
  })

  it('is null when the chart is closed AND the client is private', () => {
    expect(
      clientIdentityHref(clientLinkTarget(PRIVATE_WITH_HANDLE), false),
    ).toBeNull()
  })

  it('never invents a chart href without an id, even when allowed', () => {
    expect(
      clientIdentityHref(
        { clientProfileId: null, handle: 'ada', isPublicProfile: true },
        true,
      ),
    ).toBe('/u/ada')
  })
})

describe('resolveClientProfileHref — the batched-set entry point', () => {
  const viewer = { proVisibleClientIds: new Set(['cl_1']) }

  it('agrees with clientIdentityHref for a visible client', () => {
    expect(resolveClientProfileHref(clientLinkTarget(PUBLIC), viewer)).toBe(
      clientIdentityHref(clientLinkTarget(PUBLIC), true),
    )
  })

  it('agrees with clientIdentityHref for a client outside the set', () => {
    const other = { id: 'cl_2', handle: 'ada', isPublicProfile: true }
    expect(resolveClientProfileHref(clientLinkTarget(other), viewer)).toBe(
      clientIdentityHref(clientLinkTarget(other), false),
    )
  })

  it('gives a non-pro viewer public links only', () => {
    expect(
      resolveClientProfileHref(clientLinkTarget(PUBLIC), EMPTY_CLIENT_LINK_VIEWER),
    ).toBe('/u/ada')
    expect(
      resolveClientProfileHref(
        clientLinkTarget(PRIVATE_WITH_HANDLE),
        EMPTY_CLIENT_LINK_VIEWER,
      ),
    ).toBeNull()
  })
})

describe('clientLinkTarget', () => {
  it('degrades a missing client to "nowhere to go"', () => {
    expect(clientLinkTarget(null)).toEqual({
      clientProfileId: null,
      handle: null,
      isPublicProfile: false,
    })
    expect(clientIdentityHref(clientLinkTarget(undefined), true)).toBeNull()
  })
})

describe('clientIdentityHrefFromDto — the client-component entry point', () => {
  it('takes the chart when the server exposed an id', () => {
    expect(
      clientIdentityHrefFromDto({
        clientProfileId: 'cl_1',
        clientPublicProfileHandle: 'ada',
      }),
    ).toBe('/pro/clients/cl_1')
  })

  it('takes the public page when the server withheld the id', () => {
    expect(
      clientIdentityHrefFromDto({
        clientProfileId: null,
        clientPublicProfileHandle: 'ada',
      }),
    ).toBe('/u/ada')
  })

  it('is null when the server withheld both', () => {
    expect(
      clientIdentityHrefFromDto({
        clientProfileId: null,
        clientPublicProfileHandle: null,
      }),
    ).toBeNull()
  })

  it('matches the server-side rule for the same inputs', () => {
    expect(
      clientIdentityHrefFromDto({
        clientProfileId: null,
        clientPublicProfileHandle: 'ada',
      }),
    ).toBe(clientIdentityHref(clientLinkTarget(PUBLIC), false))
  })
})

// lib/routes' proPublicProfilePath used to build `/professionals/[id]` itself,
// a second copy of professionalProfileHref. It now delegates; this pins them
// together so they cannot drift apart again.
describe('pro profile path — one route shape, two entry points', () => {
  it('agrees with professionalProfileHref', () => {
    expect(proPublicProfilePath('pro_1')).toBe(professionalProfileHref('pro_1'))
    expect(proPublicProfilePath('a/b')).toBe(professionalProfileHref('a/b'))
  })

  it('keeps its nullable, blank-tolerant contract', () => {
    expect(proPublicProfilePath(null)).toBeNull()
    expect(proPublicProfilePath('   ')).toBeNull()
    expect(proPublicProfilePath(undefined)).toBeNull()
  })
})

describe('proClientChartHref', () => {
  it('encodes the id', () => {
    expect(proClientChartHref('a/b')).toBe('/pro/clients/a%2Fb')
  })
})
