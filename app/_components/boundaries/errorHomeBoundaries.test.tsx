// app/_components/boundaries/errorHomeBoundaries.test.tsx
//
// The boundaries that must NOT dump a signed-in viewer on the public marketing
// hero. Each case asserts the same two things: a signed-in client lands on
// /client, and a signed-out visitor still lands on "/".
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockCookies = vi.hoisted(() => vi.fn())
const mockHeaders = vi.hoisted(() => vi.fn())
const mockVerifyToken = vi.hoisted(() => vi.fn())

vi.mock('next/headers', () => ({
  cookies: mockCookies,
  headers: mockHeaders,
}))

vi.mock('@/lib/auth', () => ({
  verifyToken: mockVerifyToken,
}))

// The shared UI is exercised by its own surfaces; here we only care which href
// each boundary hands it, so render it as a bare link.
vi.mock('@/app/_components/boundaries/NotFoundState', () => ({
  default: ({ homeHref, homeLabel }: { homeHref?: string; homeLabel?: string }) => (
    <a href={homeHref}>{homeLabel}</a>
  ),
}))

vi.mock('@/app/_components/boundaries/ErrorState', () => ({
  default: ({ homeHref, homeLabel }: { homeHref?: string; homeLabel?: string }) => (
    <a href={homeHref}>{homeLabel}</a>
  ),
}))

import { ErrorHomeProvider } from './ErrorHomeProvider'
import { CLIENT_HOME, GUEST_HOME, PRO_HOME } from './errorHome'
import { resolveErrorHome } from './errorHomeHref'

import GlobalRouteError from '@/app/error'
import PublicProfileError from '@/app/u/[handle]/error'
import PublicProfileNotFound from '@/app/u/[handle]/not-found'
import ProfessionalsNotFound from '@/app/professionals/not-found'
import ProfessionalsError from '@/app/professionals/error'

function signedInAs(role: 'CLIENT' | 'PRO'): void {
  mockCookies.mockResolvedValue({
    get: (name: string) =>
      name === 'tovis_token' ? { value: 'a-token' } : undefined,
  })
  mockVerifyToken.mockReturnValue({ role, sessionKind: 'ACTIVE' })
}

function signedOut(): void {
  mockCookies.mockResolvedValue({ get: () => undefined })
  mockHeaders.mockResolvedValue({ get: () => null })
}

/** Render a server component's element, awaiting it when the component is async. */
async function renderServer(
  element: React.ReactElement | Promise<React.ReactElement>,
) {
  render(await element)
}

const errorProps = {
  error: Object.assign(new Error('boom'), { digest: 'abc123' }),
  reset: () => undefined,
}

function homeLink(): HTMLAnchorElement {
  return screen.getByRole('link') as HTMLAnchorElement
}

beforeEach(() => {
  mockHeaders.mockResolvedValue({ get: () => null })
})

describe('resolveErrorHome', () => {
  it('sends a signed-in client to their own home', async () => {
    signedInAs('CLIENT')
    await expect(resolveErrorHome()).resolves.toEqual(CLIENT_HOME)
  })

  it('sends a signed-in pro to their calendar', async () => {
    signedInAs('PRO')
    await expect(resolveErrorHome()).resolves.toEqual(PRO_HOME)
  })

  it('leaves a signed-out visitor on the marketing home', async () => {
    signedOut()
    await expect(resolveErrorHome()).resolves.toEqual(GUEST_HOME)
  })

  it('degrades to the marketing home for a mid-signup session', async () => {
    mockCookies.mockResolvedValue({
      get: () => ({ value: 'a-token' }),
    })
    mockVerifyToken.mockReturnValue({
      role: 'CLIENT',
      sessionKind: 'VERIFICATION',
    })
    await expect(resolveErrorHome()).resolves.toEqual(GUEST_HOME)
  })
})

describe('app/u/[handle]/not-found', () => {
  it('sends a signed-in client to /client, not /', async () => {
    signedInAs('CLIENT')
    await renderServer(PublicProfileNotFound())
    expect(homeLink()).toHaveAttribute('href', '/client')
  })

  it('still sends a signed-out visitor to the marketing home', async () => {
    signedOut()
    await renderServer(PublicProfileNotFound())
    expect(homeLink()).toHaveAttribute('href', '/')
  })
})

describe.each([
  ['app/error', GlobalRouteError],
  ['app/u/[handle]/error', PublicProfileError],
])('%s', (_name, Boundary) => {
  it('sends a signed-in client to /client, not /', () => {
    render(
      <ErrorHomeProvider value={CLIENT_HOME}>
        <Boundary {...errorProps} />
      </ErrorHomeProvider>,
    )
    expect(homeLink()).toHaveAttribute('href', '/client')
  })

  it('still sends a signed-out visitor to the marketing home', () => {
    render(
      <ErrorHomeProvider value={GUEST_HOME}>
        <Boundary {...errorProps} />
      </ErrorHomeProvider>,
    )
    expect(homeLink()).toHaveAttribute('href', '/')
  })

  it('falls back to the marketing home with no provider above it', () => {
    render(<Boundary {...errorProps} />)
    expect(homeLink()).toHaveAttribute('href', '/')
  })
})

describe('app/professionals boundaries', () => {
  it('not-found sends "Browse pros" to a route that exists', async () => {
    signedOut()
    await renderServer(ProfessionalsNotFound())
    const link = homeLink()
    expect(link).toHaveAttribute('href', '/search')
    expect(link).not.toHaveAttribute('href', '/professionals')
  })

  it('error sends "Browse pros" to a route that exists', () => {
    render(<ProfessionalsError {...errorProps} />)
    expect(homeLink()).toHaveAttribute('href', '/search')
  })
})
